'use strict'
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k
        var desc = Object.getOwnPropertyDescriptor(m, k)
        if (!desc || ('get' in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k]
            },
          }
        }
        Object.defineProperty(o, k2, desc)
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k
        o[k2] = m[k]
      })
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, 'default', { enumerable: true, value: v })
      }
    : function (o, v) {
        o['default'] = v
      })
var __importStar =
  (this && this.__importStar) ||
  function (mod) {
    if (mod && mod.__esModule) return mod
    var result = {}
    if (mod != null)
      for (var k in mod)
        if (k !== 'default' && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k)
    __setModuleDefault(result, mod)
    return result
  }
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
exports.restClientBuilder = void 0
const superagent_1 = __importDefault(require('superagent'))
const agentkeepalive_1 = __importStar(require('agentkeepalive'))
function sanitiseError(error) {
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
function restClientBuilder(name, config, logger) {
  return token => new RestClient(name, config, token, logger)
}
exports.restClientBuilder = restClientBuilder
class RestClient {
  constructor(name, config, token, logger) {
    this.name = name
    this.config = config
    this.token = token
    this.logger = logger
    this.agent = config.url.startsWith('https')
      ? new agentkeepalive_1.HttpsAgent(config.agent)
      : new agentkeepalive_1.default(config.agent)
  }
  apiUrl() {
    return this.config.url
  }
  timeoutConfig() {
    return this.config.timeout
  }
  async get({ path = null, query = '', headers = {}, responseType = '', raw = false }) {
    this.logger.info(`Get using user credentials: calling ${this.name}: ${path} ${query}`)
    try {
      const result = await superagent_1.default
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
  async post({ path = null, headers = {}, responseType = '', data = {}, raw = false } = {}) {
    this.logger.info(`Post using user credentials: calling ${this.name}: ${path}`)
    try {
      const result = await superagent_1.default
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
}
exports.default = RestClient
//# sourceMappingURL=restClient.js.map
