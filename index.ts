/* eslint-disable no-console */
/* eslint-disable no-shadow */
/* eslint-disable @typescript-eslint/no-explicit-any */
import session, { Store } from 'express-session'
import { CookieOptions, RequestHandler } from 'express'
import { createClient } from 'redis'
import RedisStore from 'connect-redis'
import RestClient, { Logger } from './restClient'

type RedisClient = ReturnType<typeof createClient>
interface HmppsSessionConfig {
  serviceName: string
  session: {
    secret: string | string[]
  }
  sharedSessionApi: {
    baseUrl: string
    token: string
  }
  cookie: CookieOptions
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

export interface HmppsSessionOptions {
  sessionSecret: string | string[]
  cookie: CookieOptions
  sharedSessionApi: { baseUrl: string; token: string; timeout?: number }
}

// eslint-disable-next-line import/prefer-default-export
export function hmppsSessionBuilder(client: RedisClient, options: HmppsSessionOptions, logger?: Logger) {
  const timeout = options.sharedSessionApi.timeout || 20000
  return (serviceName: string) =>
    hmppsSession(
      client,
      new RestClient(
        'HMPPS Central Session',
        {
          url: options.sharedSessionApi.baseUrl,
          agent: { timeout },
          timeout: { response: timeout, deadline: timeout },
        },
        options.sharedSessionApi.token,
        logger,
      ),
      {
        serviceName,
        session: { secret: options.sessionSecret },
        sharedSessionApi: options.sharedSessionApi,
        cookie: options.cookie,
      },
    )
}

function hmppsSession(client: RedisClient, apiClient: RestClient, config: HmppsSessionConfig): RequestHandler {
  return session({
    store: new HmppsSessionStore(client, apiClient, config.serviceName),
    cookie: config.cookie,
    secret: config.session.secret,
    resave: false, // redis implements touch so shouldn't need this
    saveUninitialized: false,
    rolling: true,
  })
}

class HmppsSessionStore extends Store {
  private serviceStore: RedisStore

  private serviceClient: RedisClient

  constructor(
    client: RedisClient,
    private apiClient: RestClient,
    private serviceName: string,
  ) {
    super()
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
    await this.ensureConnections()
    let localSession: any
    let centralSession: CentralSession
    const setLocal = (err: any, sessionRes?: session.SessionData) => {
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
    await this.ensureConnections()
    const { passport, ...localSession } = session as any
    const c = (err?: string) => {
      if (err) console.log(err)
    }

    const setRemoteSession = async () => {
      if (passport) {
        await this.apiClient.post({
          path: `/sessions/${sid}/${this.serviceName}`,
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
    const deleteRemoteSession = async () => {
      await this.apiClient.delete({ path: `/sessions/${sid}/${this.serviceName}` })
    }

    await Promise.all([this.serviceStore.destroy(sid), deleteRemoteSession()])
    if (callback) callback()
  }
}
