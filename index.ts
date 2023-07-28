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
export function hmppsSessionBuilder(client: RedisClient, options: HmppsSessionOptions, logger: Logger) {
  logger.info(`CENTRAL SESSION options: ${options}`)
  logger.info(`CENTRAL SESSION client: ${client}`)
  const timeout = options.sharedSessionApi.timeout || 20000
  return (serviceName: string) =>
    hmppsSession(
      client,
      new RestClient(
        'HMPPS Central Session',
        {
          url: `${options.sharedSessionApi.baseUrl}/sessions`,
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
      logger,
    )
}

function hmppsSession(
  client: RedisClient,
  apiClient: RestClient,
  config: HmppsSessionConfig,
  logger: Logger,
): RequestHandler {
  return session({
    store: new HmppsSessionStore(client, apiClient, config.serviceName, logger),
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
    private logger: Logger,
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

  private getRemoteSession = async (sid: string): Promise<CentralSession> => {
    try {
      return await this.apiClient.get<CentralSession>({ path: `/${sid}/${this.serviceName}` })
    } catch (e) {
      return {}
    }
  }

  async get(sid: string, callback: (err: any, session?: session.SessionData) => void): Promise<void> {
    await this.ensureConnections()

    let localSession: any
    await this.serviceStore.get(sid, (err: any, sessionRes?: session.SessionData) => {
      localSession = sessionRes
    })
    this.logger.info(`CENTRAL SESSION get local, ${localSession}`)
    if (!localSession) return callback('', localSession)

    const remoteSession = await this.getRemoteSession(sid)
    this.logger.info(`CENTRAL SESSION get remote, ${remoteSession}`)
    return callback('', { ...localSession, ...remoteSession } as any)
  }

  async set(sid: string, session: session.SessionData, callback?: (err?: any) => void): Promise<void> {
    await this.ensureConnections()
    const { passport, ...localSession } = session as any
    const c = (err?: string) => {
      if (err) console.log(err)
    }

    const setRemoteSession = async () => {
      if (passport) {
        this.logger.info(`CENTRAL SESSION setting remote session`)
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
    const deleteRemoteSession = async () => {
      await this.apiClient.delete({ path: `/${sid}/${this.serviceName}` })
    }

    await Promise.all([this.serviceStore.destroy(sid), deleteRemoteSession()])
    if (callback) callback()
  }
}
