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
exports.HmppsSessionStore = exports.hmppsSession = exports.hmppsSessionBuilder = void 0
/* eslint-disable no-console */
/* eslint-disable no-shadow */
const express_session_1 = __importStar(require('express-session'))
const connect_redis_1 = __importDefault(require('connect-redis'))
const axios_1 = __importDefault(require('axios'))
const restClient_1 = __importDefault(require('./restClient'))
/*
 This can be used to avoid memory errors in component services that are required to create new instances at runtime
 in order to pass in the service name per-request
 */
function hmppsSessionBuilder(client, https, sessionSecret, sharedSessionApi, timeout = 20000) {
  return serviceName =>
    hmppsSession(
      client,
      new restClient_1.default(
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
exports.hmppsSessionBuilder = hmppsSessionBuilder
function hmppsSession(client, apiClient, config) {
  return (0, express_session_1.default)({
    store: new HmppsSessionStore(client, apiClient, config),
    cookie: {
      secure: config.https,
      sameSite: 'lax',
      maxAge: 120 * 60 * 1000, // 120 minutes
    },
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
  })
}
exports.hmppsSession = hmppsSession
class HmppsSessionStore extends express_session_1.Store {
  constructor(client, apiClient, config) {
    super()
    this.apiClient = apiClient
    this.config = config
    this.serviceName = config.serviceName
    this.serviceClient = client
    this.serviceStore = new connect_redis_1.default({ client })
  }
  async ensureClientConnected(client) {
    if (!client.isOpen) {
      await client.connect()
    }
  }
  async ensureConnections() {
    await this.ensureClientConnected(this.serviceClient)
  }
  async get(sid, callback) {
    console.log(`[hmpps-central-session] Getting session for ${this.serviceName}: ${sid}`)
    await this.ensureConnections()
    let localSession
    let centralSession
    const setLocal = (err, sessionRes) => {
      if (err) console.log('[hmpps-central-session] Error getting local: ', err)
      localSession = sessionRes || {}
    }
    const getRemoteSession = async () => {
      try {
        centralSession = await this.apiClient.get({ path: `/${sid}/${this.serviceName}` })
      } catch (e) {
        centralSession = {}
      }
    }
    await Promise.all([this.serviceStore.get(sid, setLocal), getRemoteSession()])
    const session = {
      ...localSession,
      ...centralSession,
    }
    callback('', session)
  }
  async set(sid, session, callback) {
    console.log(`[hmpps-central-session] Setting session for ${this.serviceName}: ${sid}`)
    await this.ensureConnections()
    const { passport, ...localSession } = session
    const c = err => {
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
  async destroy(sid, callback) {
    console.log(`[hmpps-central-session] Destroying session for ${this.serviceName}: ${sid}`)
    async function deleteRemoteSession(sessionId, serviceName, baseUrl) {
      await axios_1.default.delete(`${baseUrl}/${sessionId}/${serviceName}`)
    }
    await Promise.all([
      this.serviceStore.destroy(sid, err => {
        if (err) console.log('[hmpps-central-session] Destruction service: ', err)
      }),
      deleteRemoteSession(sid, this.serviceName, this.config.sharedSessionApi.baseUrl),
    ])
    if (callback) callback()
  }
}
exports.HmppsSessionStore = HmppsSessionStore
//# sourceMappingURL=index.js.map
