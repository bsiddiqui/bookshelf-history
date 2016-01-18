'use strict'

module.exports = {
  development: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    migrations: {
      directory: `${__dirname}/migrations`
    }
  }
}
