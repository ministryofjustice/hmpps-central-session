/* eslint-disable no-console */
/* eslint-disable no-shadow */
import session, { Store } from 'express-session'
import { RequestHandler } from 'express'
import { createClient } from 'redis'
import RedisStore from 'connect-redis'
import RestClient from './restClient'

export type RedisClient = ReturnType<typeof createClient>
export interface HmppsSessionConfig {
  serviceName: string
  https: boolean
  session: {
    secret: string
  }
  sharedSessionApi: {
    baseUrl: string
    token: string
  }
}

declare module 'express-session' {
  // Declare that the session will potentially contain these additional fields
  interface SessionData {
    nowInMinutes: number
  }
}

interface CentralSession {
  passport?: {
    user: {
      token: string
      username: string
      authSource: string
    }
  }
}

/*
 This can be used to avoid memory errors in component services that are required to create new instances at runtime
 in order to pass in the service name per-request
 */
export function hmppsSessionBuilder(
  client: RedisClient,
  https: boolean,
  sessionSecret: string,
  sharedSessionApi: { baseUrl: string; token: string },
  timeout = 20000,
) {
  return (serviceName: string) =>
    hmppsSession(
      client,
      new RestClient(
        'HMPPS Central Session',
        {
          url: sharedSessionApi.baseUrl,
          agent: { timeout },
          timeout: { response: timeout, deadline: timeout },
        },
        sharedSessionApi.token,
        console,
      ),
      {
        serviceName,
        https,
        session: { secret: sessionSecret },
        sharedSessionApi,
      },
    )
}

export function hmppsSession(client: RedisClient, apiClient: RestClient, config: HmppsSessionConfig): RequestHandler {
  return session({
    store: new HmppsSessionStore(client, apiClient, config),
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

  constructor(client: RedisClient, private apiClient: RestClient, private config: HmppsSessionConfig) {
    super()
    this.serviceName = config.serviceName
    this.serviceClient = client
    this.serviceStore = new RedisStore({ client })
  }

  private async ensureClientConnected(client: RedisClient) {
    if (!client.isOpen) {
      await client.connect()
    }
  }

  private async ensureConnections() {
    await this.ensureClientConnected(this.serviceClient)
  }

  async get(sid: string, callback: (err: any, session?: session.SessionData) => void): Promise<void> {
    console.log(`[hmpps-central-session] Getting session for ${this.serviceName}: ${sid}`)
    await this.ensureConnections()
    let localSession: any
    let centralSession: CentralSession
    const setLocal = (err: any, sessionRes?: session.SessionData) => {
      if (err) console.log('[hmpps-central-session] Error getting local: ', err)
      localSession = sessionRes || {}
    }

    const getRemoteSession = async () => {
      try {
        centralSession = await this.apiClient.get<CentralSession>({ path: `/${sid}/${this.serviceName}` })
      } catch (e) {
        centralSession = {}
      }
    }

    await Promise.all([this.serviceStore.get(sid, setLocal), getRemoteSession()])

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

    const setRemoteSession = async () => {
      if (passport) {
        await this.apiClient.post({
          path: `/${sid}/${this.serviceName}`,
          data: {
            passport,
          },
        })
      }
    }

    await Promise.all([this.serviceStore.set(sid, { ...localSession }, c), setRemoteSession()])
    callback()
  }

  async destroy(sid: string, callback?: (err?: any) => void): Promise<void> {
    console.log(`[hmpps-central-session] Destroying session for ${this.serviceName}: ${sid}`)
    const deleteRemoteSession = async () => {
      await this.apiClient.delete({ path: `/${sid}/${this.serviceName}` })
    }

    await Promise.all([
      this.serviceStore.destroy(sid, (err: any) => {
        if (err) console.log('[hmpps-central-session] Destruction service: ', err)
      }),
      deleteRemoteSession(),
    ])
    if (callback) callback()
  }
}
