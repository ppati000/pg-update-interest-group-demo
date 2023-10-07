import { Pool } from 'pg'
import { setTimeout } from 'node:timers/promises'
import * as async from 'async'

const CONNECTIONS = 100
const CONCURRENCY = parseInt(process.argv[2])

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'internals',
  min: CONNECTIONS,
  max: CONNECTIONS
})

async function main() {
  await pool.query('TRUNCATE TABLE person')

  const warmup = Array(100).fill('SELECT * FROM person')
  await Promise.all(warmup.map((query) => pool.query(query)))
  console.log('Pool has ' + pool.idleCount + ' connections.')
  console.log('Concurrency: ' + CONCURRENCY)

  console.time('insert')
  const queries = Array(1000).fill(`INSERT INTO person VALUES (null, true, 'foo')`)
  await async.forEachLimit(queries, CONCURRENCY, async (query) => pool.query(query))
  console.timeEnd('insert')
  await pool.end()
}

main()
