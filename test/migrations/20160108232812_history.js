'use strict'

exports.up = function (knex) {
  return knex.schema.createTable('history', function (table) {
    table.increments('id').primary().notNullable()
    table.integer('sequence').notNullable()
    table.string('operation').notNullable()
    table.boolean('patch').notNullable()
    table.string('resource_type').notNullable()
    table.integer('resource_id').notNullable()
    table.string('data', 2097152)
    table.timestamp('created_at').defaultTo(knex.fn.now())
  })
}

exports.down = function (knex) {
  return knex.schema.dropTable('history')
}
