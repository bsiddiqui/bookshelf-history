'use strict'

exports.up = async (knex) => {
  await knex.schema.createTable('history', function (t) {
    t.uuid('id')
      .primary()
      .notNullable()
      .defaultTo(knex.raw('uuid_generate_v4()'))
    t.integer('sequence').notNullable()
    t.string('operation').notNullable()
    t.boolean('patch').notNullable()
    t.string('resource_type').notNullable()
    t.uuid('resource_id').notNullable()
    t.jsonb('metadata')
    t.jsonb('diff')
    t.jsonb('data')
    t.timestamp(true, true)
  })
}

exports.down = async (knex) => {
  await knex.schema.dropTable('history')
}
