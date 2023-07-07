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
  private serviceStore: RedisStore

  private serviceClient: RedisClient

  private serviceName: string

  private config: HmppsSessionConfig

  constructor(client: RedisClient, config: HmppsSessionConfig) {
    super()
    this.serviceName = config.serviceName
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
    await Promise.all([this.ensureClientConnected(this.serviceClient)])
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

    async function getRemoteSession(sessionId: string, serviceName: string, baseUrl: string) {
      try {
        const res = await axios.get(`${baseUrl}/${sessionId}/${serviceName}`)
        console.log(res.data)
        centralSession = res.data
      } catch (e) {
        console.log('Error!')
        console.log(e)
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
    const { passport, ...localSession } = session as any
    const c = (err?: string) => {
      if (err) console.log(err)
    }

    async function setRemoteSession(sessionId: string, serviceName: string, baseUrl: string) {
      if (passport) {
        try {
          const res = await axios.post(`${baseUrl}/${sessionId}/${serviceName}`, {
            passport,
          })
          console.log(res.status)
        } catch (e) {
          console.log(e)
        }
      }
    }

    await Promise.all([
      this.serviceStore.set(sid, { ...localSession }, c),
      setRemoteSession(sid, this.serviceName, this.config.sharedSessionApi.baseUrl),
    ])
    callback()
  }

  async destroy(sid: string, callback?: (err?: any) => void): Promise<void> {
    console.trace('Destroying session: ', sid)
    async function deleteRemoteSession(sessionId: string, serviceName: string, baseUrl: string) {
      try {
        const res = await axios.delete(`${baseUrl}/${sessionId}/${serviceName}`)
        console.log(res.status)
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
