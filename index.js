'use strict'

const chalk = require('chalk')
const debug = require('debug')('pardsrl:collector')
const Redis = require('redis')
const sleep = require('sleep')
const {promisify} = require('util')

const PardAgent = require('pardsrl-agent')
const { parsePayload } = require('pardsrl-agent/utils')

const { agent: agentCfg, metrics, redis } = require('./config')

// redis connection
const redisClient = Redis.createClient({
  host: redis.host,
  port: redis.port
})

const llenAsync = promisify(redisClient.llen).bind(redisClient)

redisClient.on('connect', () => {
  debug(chalk.blue('[REDIS]'), 'Redis connected to server.')
})
redisClient.on('error', handleFatalError)

let _interval = agentCfg.interval

const agent = new PardAgent({
  nombre:   agentCfg.name,
  uuid:     agentCfg.uuid,
  interval: _interval,
  mqtt: {
    host: agentCfg.mqtt
  }
})

let _currentMetricsValues = {}
let _clientConnected = false
let _resetMetrics = null
let _syncX = 1

metrics.forEach((metric) => {
  setDefaultMetricValue(metric)

  // add metric to agent for report to mqtt server
  agent.addMetric(metric, () => {
    return {
      t: _currentMetricsValues[metric].time || new Date().getTime(),
      value: _currentMetricsValues[metric].value
    }
  })
})

agent.connect()

// setTimeout(()=> agent.setInterval(250),5000)
// setTimeout(()=> agent.setInterval(interval),20000)
// setTimeout(()=> agent.disconnect(),30000)
// setTimeout(()=> agent.connect(),40000)

// This agent only
agent.on('connected', () => {
  debug(chalk.green(`agent connected`))
  _clientConnected = true
  waitForRedisPush()
})
agent.on('disconnected', () => {
  _clientConnected = false
})
agent.on('message', () => {
  // reset metrics
  _resetMetrics && process.nextTick(resetMetrics)
})

agent.on('reconnecting', () => {
  _clientConnected = false
  debug(chalk.green(`reconnecting...`))
})

// Other Agents
agent.on('agent/connected', handler)
agent.on('agent/disconnected', handler)
agent.on('agent/message', (payload)=>{
  console.log(payload)
})

/**
 * Reset metrics to default value
 *
 */
function resetMetrics () {
  metrics.forEach((metric) => {
    // set an array with current values for each metric defined
    setDefaultMetricValue(metric)
  })
  _resetMetrics = false
}
/**
 * Set default value for a given metric
 *
 * @param {string} metric name of metric
 */
function setDefaultMetricValue (metric) {
  _currentMetricsValues[metric] = {
    time: null,
    value: -1000
  }
}

/**
 * Waits for new redis data in stream collection.
 * This function updates internal _currentMetricsValues to be report in agent
 *
 */
async function waitForRedisPush () {
  redisClient.brpop(redis.queue, 0, async (err, data) => {
    err && handleError(err)

    // debug(chalk.blue('[REDIS DATA]'), err, data)
    let payload = parsePayload(data[1])

    if (payload) {
      // set internal flag to reset metric on next agent message
      _resetMetrics = true
      // iterate payload searching for valid metrics
      for (let metric in payload) {
        if (metrics.indexOf(metric) && metric !== 't') {
          // get time from payload and store in current metric time
          _currentMetricsValues[metric].time = payload.t || null
          // store metric in current metric value
          _currentMetricsValues[metric].value = payload[metric]
        }
      }
    } else {
      debug(chalk.red('[REDIS DATA] Invalid Json'))
    }

    let queueLength = await llenAsync(redis.queue).catch(handleError)

    debug(chalk.red(queueLength))

    // if redis queue has not synchronized data this block accelerates velocity to 10x faster
    if (queueLength > 0) {
      // if is first time, waits original interval for prevent, reads before reports
      if (_syncX === 1) {
        _syncX = 10
        agent.setInterval(_interval / _syncX)
        sleep.msleep(_interval) // the wait trick
      } else {
        sleep.msleep(_interval / _syncX) // faster report 
      }
    } else {
      // reset all to original settings
      _syncX = 1
      agent.setInterval(_interval)
      sleep.msleep(_interval)
    }

    waitForRedisPush()
  })
}

function handler (payload) {
  // console.log('payload', payload)
  return true
}

function handleError (err) {
  console.error(`${chalk.red('[error]')} ${err.message}`)
  console.error(err.stack)
}

function handleFatalError (err) {
  console.error(`${chalk.red('[fatal error]')} ${err.message}`)
  console.error(err.stack)
  process.exit(1)
}

process.on('uncaughtException', handleFatalError)
process.on('unhandledRejection', handleFatalError)
