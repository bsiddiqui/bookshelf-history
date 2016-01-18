'use strict'

exports.up = function (knex) {
  return knex.schema.createTable('history_json', function (table) {
    table.increments('id').primary().notNullable()
    table.integer('sequence').notNullable()
    table.string('operation').notNullable()
    table.boolean('patch').notNullable()
    table.string('resource_type').notNullable()
    table.integer('resource_id').notNullable()
    table.json('data')
    table.timestamp('created_at').defaultTo(knex.fn.now())
  })
}

exports.down = function (knex) {
  return knex.schema.dropTable('history_json')
}
