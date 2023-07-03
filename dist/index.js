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
exports.HmppsSessionStore = exports.hmppsSession = exports.createSharedRedisClient = void 0
/* eslint-disable no-console */
/* eslint-disable no-shadow */
const express_session_1 = __importStar(require('express-session'))
const redis_1 = require('redis')
const connect_redis_1 = __importDefault(require('connect-redis'))
const axios_1 = __importDefault(require('axios'))
const createSharedRedisClient = config => {
  const url =
    config.sharedSession.tls_enabled === 'true'
      ? `rediss://${config.sharedSession.host}:${config.sharedSession.port}`
      : `redis://${config.sharedSession.host}:${config.sharedSession.port}`
  const client = (0, redis_1.createClient)({
    url,
    password: config.sharedSession.password,
    socket: {
      reconnectStrategy: attempts => {
        // Exponential back off: 20ms, 40ms, 80ms..., capped to retry every 30 seconds
        const nextDelay = Math.min(2 ** attempts * 20, 30000)
        console.info(`Retry Redis connection attempt: ${attempts}, next attempt in: ${nextDelay}ms`)
        return nextDelay
      },
    },
  })
  client.on('error', e => console.error('Redis client error', e))
  return client
}
exports.createSharedRedisClient = createSharedRedisClient
function hmppsSession(client, config) {
  return (0, express_session_1.default)({
    store: new HmppsSessionStore(client, config),
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
  constructor(client, config) {
    super()
    this.serviceName = config.serviceName
    this.sharedSessionClient = (0, exports.createSharedRedisClient)(config)
    this.sharedSessionStore = new connect_redis_1.default({
      client: this.sharedSessionClient,
    })
    this.serviceClient = client
    this.serviceStore = new connect_redis_1.default({ client })
    this.config = config
  }
  async ensureClientConnected(client) {
    if (!client.isOpen) {
      await client.connect()
    }
  }
  async ensureConnections() {
    await Promise.all([
      this.ensureClientConnected(this.sharedSessionClient),
      this.ensureClientConnected(this.serviceClient),
    ])
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
    const setCentral = (err, sessionRes) => {
      if (err) console.log('[hmpps-central-session] Error getting central: ', err)
      centralSession = sessionRes || {}
    }
    async function getRemoteSession(sessionId, serviceName, baseUrl) {
      try {
        const res = await axios_1.default.get(`${baseUrl}/${sessionId}/${serviceName}`)
        console.log(res.data)
        centralSession = JSON.parse(res.data)
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
    callback('', session)
  }
  async set(sid, session, callback) {
    console.log(`[hmpps-central-session] Setting session for ${this.serviceName}: ${sid}`)
    await this.ensureConnections()
    const { cookie, passport, nowInMinutes, ...localSession } = session
    const c = err => {
      if (err) console.log(err)
    }
    const sharedSession = { cookie, tokens: {}, nowInMinutes }
    if (passport && passport.user) {
      if (passport.user.username) sharedSession.username = passport.user.username
      if (passport.user.authSource) sharedSession.authSource = passport.user.username
      if (passport.user.token) sharedSession.tokens[this.serviceName] = passport.user.token
    }
    async function setRemoteSession(sessionId, serviceName, baseUrl) {
      try {
        const res = await axios_1.default.post(`${baseUrl}/${sessionId}/${serviceName}`, {
          cookie,
          passport,
        })
        console.log(res.status)
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
  async destroy(sid, callback) {
    console.trace('Destroying session: ', sid)
    async function deleteRemoteSession(sessionId, serviceName, baseUrl) {
      try {
        const res = await axios_1.default.delete(`${baseUrl}/${sessionId}/${serviceName}`)
        console.log(res.status)
      } catch (e) {
        console.log(e)
      }
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
