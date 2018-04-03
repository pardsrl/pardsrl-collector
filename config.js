'use strict'

const uuid = require('machine-uuid-sync')()

let metrics = process.env.METRICS.split(',') || []

module.exports = {
  redis: {
    host: process.env.REDIS_HOST   || 'localhost',
    port: process.env.REDIS_PORT   || 6379,
    queue: process.env.REDIS_QUEUE ||'streams'
  },
  agent:{
    uuid:     process.env.UUID || uuid,
    interval: process.env.INTERVAL || 1000,
    mqtt:     process.env.MQTT || 'mqtt://localhost'
  },
  metrics
}
