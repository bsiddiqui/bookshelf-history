'use strict'

exports.up = function (knex) {
  return knex.schema.createTable('test', function (table) {
    table.increments('id').primary().notNullable()
    table.string('name').notNullable()
    table.string('email').notNullable()
  })
}

exports.down = function (knex) {
  return knex.schema.dropTable('test')
}
