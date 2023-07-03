/* eslint-disable no-console */
/* eslint-disable no-shadow */
import session, { Store } from 'express-session'
import { RequestHandler } from 'express'
import { createClient } from 'redis'
import RedisStore from 'connect-redis'
import axios from 'axios'

export type RedisClient = ReturnType<typeof createClient>
export interface HmppsSessionConfig {
  serviceName: string
  https: boolean
  session: {
    secret: string
  }
  sharedSession: {
    host: string
    port: number
    password: string
    tls_enabled: string
  }
  sharedSessionApi: {
    baseUrl: string
  }
}

declare module 'express-session' {
  // Declare that the session will potentially contain these additional fields
  interface SessionData {
    nowInMinutes: number
  }
}

export const createSharedRedisClient = (config: HmppsSessionConfig): RedisClient => {
  const url =
    config.sharedSession.tls_enabled === 'true'
      ? `rediss://${config.sharedSession.host}:${config.sharedSession.port}`
      : `redis://${config.sharedSession.host}:${config.sharedSession.port}`

  const client = createClient({
    url,
    password: config.sharedSession.password,
    socket: {
      reconnectStrategy: (attempts: number) => {
        // Exponential back off: 20ms, 40ms, 80ms..., capped to retry every 30 seconds
        const nextDelay = Math.min(2 ** attempts * 20, 30000)
        console.info(`Retry Redis connection attempt: ${attempts}, next attempt in: ${nextDelay}ms`)
        return nextDelay
      },
    },
  })

  client.on('error', (e: Error) => console.error('Redis client error', e))

  return client
}

export function hmppsSession(client: RedisClient, config: HmppsSessionConfig): RequestHandler {
  return session({
    store: new HmppsSessionStore(client, config),
    cookie: {
      secure: config.https,
      sameSite: 'lax',
      maxAge: 120 * 60 * 1000, // 120 minutes
    },
    secret: config.session.secret,
    resave: false, // redis implements touch so shouldn't need this
    saveUninitialized: false,
    rolling: true,
  })
}

export class HmppsSessionStore extends Store {
  private sharedSessionStore: RedisStore

  private sharedSessionClient: RedisClient

  private serviceStore: RedisStore

  private serviceClient: RedisClient

  private serviceName: string

  private config: HmppsSessionConfig

  constructor(client: RedisClient, config: HmppsSessionConfig) {
    super()
    this.serviceName = config.serviceName
    this.sharedSessionClient = createSharedRedisClient(config)
    this.sharedSessionStore = new RedisStore({
      client: this.sharedSessionClient,
    })
    this.serviceClient = client
    this.serviceStore = new RedisStore({ client })
    this.config = config
  }

  private async ensureClientConnected(client: RedisClient) {
    if (!client.isOpen) {
      await client.connect()
    }
  }

  private async ensureConnections() {
    await Promise.all([
      this.ensureClientConnected(this.sharedSessionClient),
      this.ensureClientConnected(this.serviceClient),
    ])
  }

  async get(sid: string, callback: (err: any, session?: session.SessionData) => void): Promise<void> {
    console.log(`[hmpps-central-session] Getting session for ${this.serviceName}: ${sid}`)
    await this.ensureConnections()
    let localSession: any
    let centralSession: any
    const setLocal = (err: any, sessionRes?: session.SessionData) => {
      if (err) console.log('[hmpps-central-session] Error getting local: ', err)
      localSession = sessionRes || {}
    }

    const setCentral = (err: any, sessionRes?: session.SessionData) => {
      if (err) console.log('[hmpps-central-session] Error getting central: ', err)
      centralSession = sessionRes || {}
    }

    async function getRemoteSession(sessionId: string, serviceName: string, baseUrl: string) {
      try {
        const res = await axios.get(`${baseUrl}/${sessionId}/${serviceName}`)
        centralSession = JSON.parse(res.data())
        console.log(centralSession)
      } catch (e) {
        centralSession = {}
      }
    }

    await Promise.all([
      this.serviceStore.get(sid, setLocal),
      getRemoteSession(sid, this.serviceName, this.config.sharedSessionApi.baseUrl),
    ])

    const session = {
      ...localSession,
      ...centralSession,
    }
    callback('', session as any)
  }

  async set(sid: string, session: session.SessionData, callback?: (err?: any) => void): Promise<void> {
    console.log(`[hmpps-central-session] Setting session for ${this.serviceName}: ${sid}`)
    await this.ensureConnections()
    const { cookie, passport, nowInMinutes, ...localSession } = session as any
    const c = (err?: string) => {
      if (err) console.log(err)
    }

    const sharedSession: any = { cookie, tokens: {}, nowInMinutes }
    if (passport && passport.user) {
      if (passport.user.username) sharedSession.username = passport.user.username
      if (passport.user.authSource) sharedSession.authSource = passport.user.username
      if (passport.user.token) sharedSession.tokens[this.serviceName] = passport.user.token
    }

    async function setRemoteSession(sessionId: string, serviceName: string, baseUrl: string) {
      try {
        const res = await axios.post(`${baseUrl}/${sessionId}/${serviceName}`, {
          cookie,
          passport,
        })
        console.log(res)
      } catch (e) {
        console.log(e)
      }
    }

    await Promise.all([
      this.serviceStore.set(sid, { ...localSession, nowInMinutes }, c),
      setRemoteSession(sid, this.serviceName, this.config.sharedSessionApi.baseUrl),
    ])
    callback()
  }

  async destroy(sid: string, callback?: (err?: any) => void): Promise<void> {
    console.trace('Destroying session: ', sid)
    async function deleteRemoteSession(sessionId: string, serviceName: string, baseUrl: string) {
      try {
        const res = await axios.delete(`${baseUrl}/${sessionId}/${serviceName}`)
        console.log(res)
      } catch (e) {
        console.log(e)
      }
    }

    await Promise.all([
      this.serviceStore.destroy(sid, (err: any) => {
        if (err) console.log('[hmpps-central-session] Destruction service: ', err)
      }),
      deleteRemoteSession(sid, this.serviceName, this.config.sharedSessionApi.baseUrl),
    ])
    if (callback) callback()
  }
}
