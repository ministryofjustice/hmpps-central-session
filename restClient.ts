import superagent from 'superagent'
import type { ResponseError } from 'superagent'
import Agent, { HttpsAgent } from 'agentkeepalive'

// import { restClientMetricsMiddleware } from './restClientMetricsMiddleware'

interface ApiConfig {
  url: string
  timeout: {
    response: number
    deadline: number
  }
  agent: { timeout: number }
}

interface SanitisedError {
  text?: string
  status?: number
  headers?: unknown
  data?: unknown
  stack: string
  message: string
}

type UnsanitisedError = ResponseError

function sanitiseError(error: UnsanitisedError): SanitisedError {
  if (error.response) {
    return {
      text: error.response.text,
      status: error.response.status,
      headers: error.response.headers,
      data: error.response.body,
      message: error.message,
      stack: error.stack,
    }
  }
  return {
    message: error.message,
    stack: error.stack,
  }
}

interface GetRequest {
  path?: string
  query?: string
  headers?: Record<string, string>
  responseType?: string
  raw?: boolean
}

interface PostRequest {
  path?: string
  headers?: Record<string, string>
  responseType?: string
  data?: Record<string, unknown>
  raw?: boolean
}

interface DeleteRequest {
  path?: string
  headers?: Record<string, string>
  responseType?: string
  data?: Record<string, unknown>
  raw?: boolean
}

export type RestClientBuilder = (token: string) => RestClient

export function restClientBuilder(name: string, config: ApiConfig, logger: any): RestClientBuilder {
  return (token: string): RestClient => new RestClient(name, config, token, logger)
}

export default class RestClient {
  agent: Agent

  constructor(
    private readonly name: string,
    private readonly config: ApiConfig,
    private readonly token: string,
    private readonly logger: { info: (...data: any[]) => void; warn: (...data: any[]) => void },
  ) {
    this.agent = config.url.startsWith('https') ? new HttpsAgent(config.agent) : new Agent(config.agent)
  }

  private apiUrl() {
    return this.config.url
  }

  private timeoutConfig() {
    return this.config.timeout
  }

  async get<T>({ path = null, query = '', headers = {}, responseType = '', raw = false }: GetRequest): Promise<T> {
    this.logger.info(`Get using user credentials: calling ${this.name}: ${path} ${query}`)
    try {
      const result = await superagent
        .get(`${this.apiUrl()}${path}`)
        .agent(this.agent)
        // .use(restClientMetricsMiddleware)
        .retry(2, (err, res) => {
          if (err) this.logger.info(`Retry handler found API error with ${err.code} ${err.message}`)
          return undefined // retry handler only for logging retries, not to influence retry logic
        })
        .query(query)
        // There's no auth for now
        // .auth(this.token, { type: 'bearer' })
        .set(headers)
        .responseType(responseType)
        .timeout(this.timeoutConfig())

      return raw ? result : result.body
    } catch (error) {
      const sanitisedError = sanitiseError(error)
      this.logger.warn({ ...sanitisedError, query }, `Error calling ${this.name}, path: '${path}', verb: 'GET'`)
      throw sanitisedError
    }
  }

  async post({
    path = null,
    headers = {},
    responseType = '',
    data = {},
    raw = false,
  }: PostRequest = {}): Promise<unknown> {
    this.logger.info(`Post using user credentials: calling ${this.name}: ${path}`)
    try {
      const result = await superagent
        .post(`${this.apiUrl()}${path}`)
        .send(data)
        .agent(this.agent)
        // .use(restClientMetricsMiddleware)
        .retry(2, (err, res) => {
          if (err) this.logger.info(`Retry handler found API error with ${err.code} ${err.message}`)
          return undefined // retry handler only for logging retries, not to influence retry logic
        })
        // There's no auth for now
        // .auth(this.token, { type: 'bearer' })
        .set(headers)
        .responseType(responseType)
        .timeout(this.timeoutConfig())

      return raw ? result : result.body
    } catch (error) {
      const sanitisedError = sanitiseError(error)
      this.logger.warn({ ...sanitisedError }, `Error calling ${this.name}, path: '${path}', verb: 'POST'`)
      throw sanitisedError
    }
  }

  async delete({
    path = null,
    headers = {},
    responseType = '',
    data = {},
    raw = false,
  }: DeleteRequest = {}): Promise<unknown> {
    this.logger.info(`Delete using user credentials: calling ${this.name}: ${path}`)
    try {
      const result = await superagent
        .delete(`${this.apiUrl()}${path}`)
        .send(data)
        .agent(this.agent)
        // .use(restClientMetricsMiddleware)
        .retry(2, (err, res) => {
          if (err) this.logger.info(`Retry handler found API error with ${err.code} ${err.message}`)
          return undefined // retry handler only for logging retries, not to influence retry logic
        })
        // There's no auth for now
        // .auth(this.token, { type: 'bearer' })
        .set(headers)
        .responseType(responseType)
        .timeout(this.timeoutConfig())

      return raw ? result : result.body
    } catch (error) {
      const sanitisedError = sanitiseError(error)
      this.logger.warn({ ...sanitisedError }, `Error calling ${this.name}, path: '${path}', verb: 'DELETE'`)
      throw sanitisedError
    }
  }
}
