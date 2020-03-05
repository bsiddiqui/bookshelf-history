'use strict'

require('dotenv').config()

const Lab = require('@hapi/lab')
const lab = exports.lab = Lab.script()
const Code = require('@hapi/code')
const expect = Code.expect
const knex = require('knex')(require('./knexfile').development)
const bookshelf = require('bookshelf')(knex)

bookshelf.plugin(require('../'))
const Test = bookshelf.Model.extend({ tableName: 'test', history: true })
const History = Test.historyModel()

lab.before(async () => {
  await knex.migrate.latest()
})

lab.describe('bookshelf-history', () => {
  lab.test('it runs with default arguments', async () => {
    const model = await Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    }).save()

    await model.set('name', 'Jonny').save()
    const results = await History.where({ resource_type: model.tableName, resource_id: model.id }).fetchAll()
    const historyModels = results.models
    expect(historyModels).to.have.length(2)

    let history = historyModels.find((m) => {
      return m.get('operation') === 'created' && m.get('sequence') === 1
    })
    expect(history).to.exist()
    expect(JSON.parse(history.get('data')).name).to.equal('John Doe')
    history = historyModels.find((m) => {
      return m.get('operation') === 'updated' && m.get('sequence') === 2
    })
    expect(history).to.exist()
    expect(JSON.parse(history.get('data')).name).to.equal('Jonny')
  })

  lab.test('it detects patch operation', async () => {
    const model = await Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    }).save()

    await model.save({ name: 'Jonny' }, { patch: true })
    const results = await History.where({
      resource_type: model.tableName,
      resource_id: model.id
    }).fetchAll()
    const historyModels = results.models
    expect(historyModels).to.have.length(2)

    let history = historyModels.find((m) => {
      return m.get('operation') === 'created' && m.get('sequence') === 1
    })
    expect(history).to.exist()
    expect(JSON.parse(history.get('data')).name).to.equal('John Doe')
    history = historyModels.find((m) => {
      return m.get('operation') === 'updated' && m.get('sequence') === 2
    })
    expect(history).to.exist()
    expect(history.get('patch')).to.be.true()
  })

  lab.test('it does not create tuples when history is disabled', async () => {
    const Test = bookshelf.Model.extend({ tableName: 'test', history: false })

    const model = await Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    }).save()

    const results = await History.where({
      resource_type: model.tableName,
      resource_id: model.id
    }).fetchAll()

    expect(Test.historyModel()).to.be.false()
    expect(results.models.length).to.equal(0)
  })

  lab.test('it disables backup when options.history is false', async () => {
    const model = await Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    }).save()
    await model.set('name', 'changed').save(null, { history: false })
    const results = await History.where({
      resource_type: model.tableName,
      resource_id: model.id
    }).fetchAll()
    const historyModels = results.models
    expect(historyModels).to.have.length(1)
    let history = historyModels.find((m) => {
      return m.get('operation') === 'created' && m.get('sequence') === 1
    })
    expect(history).to.exist()
    history = historyModels.find((m) => {
      return m.get('operation') === 'updated'
    })
    expect(history).to.be.undefined()
  })
})

lab.describe('backup()', () => {
  lab.test('it saves a manual history', async () => {
    const Test = bookshelf.Model.extend({ tableName: 'test', history: { autoHistory: false } })

    const model = await Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    }).save()

    await Test.backup(model.id)
    const results = await History.where({
      resource_type: model.tableName,
      resource_id: model.id
    }).fetchAll()

    const historyModels = results.models
    expect(historyModels).to.have.length(1)
    const history = historyModels.find((m) => {
      return m.get('operation') === 'manual' && m.get('sequence') === 1
    })
    expect(history).to.exist()
  })

  lab.test('it accepts running transactions', async () => {
    const Test = bookshelf.Model.extend({ tableName: 'test', history: { autoHistory: false } })

    await bookshelf.transaction(async (transacting) => {
      const model = await Test.forge({
        name: 'John Doe',
        email: 'johndoe@gmail.com'
      }).save(null, { transacting })
      await Test.backup(model.id, { transacting })
      const results = await History.where({
        resource_type: model.tableName,
        resource_id: model.id
      }).fetchAll({ transacting })

      const historyModels = results.models
      expect(historyModels).to.have.length(1)
      const history = historyModels.find((m) => {
        return m.get('operation') === 'manual' && m.get('sequence') === 1
      })
      expect(history).to.exist()
    })
  })
})

lab.describe('revert()', () => {
  lab.test('it reverts', async () => {
    const model = await Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    }).save()
    await model.set('name', 'changed').save()
    await Test.revert(model.id, 1)
    const revertedModel = await Test.forge({ id: model.id }).fetch()

    expect(model.get('name')).to.equal('changed')
    expect(revertedModel.get('name')).to.equal('John Doe')

    const results = await History.where({
      resource_type: model.tableName,
      resource_id: model.id
    }).fetchAll()

    const historyModels = results.models
    expect(historyModels).to.have.length(2)
    const history = historyModels.find((m) => {
      return m.get('operation') === 'updated' && m.get('sequence') === 2
    })
    expect(history).to.exist()
    expect(JSON.parse(history.get('data')).name).to.equal('changed')
  })

  lab.test('it accepts running transactions', async () => {
    await bookshelf.transaction(async (transacting) => {
      const model = await Test.forge({
        name: 'John Doe',
        email: 'johndoe@gmail.com'
      }).save(null, { transacting })
      await model.set('name', 'changed').save(null, { transacting })
      await Test.revert(model.id, 1, { transacting })
      const revertedModel = await Test.forge({ id: model.id }).fetch({ transacting })

      expect(model.get('name')).to.equal('changed')
      expect(revertedModel.get('name')).to.equal('John Doe')

      const results = await History.where({
        resource_type: model.tableName,
        resource_id: model.id
      }).fetchAll({ transacting })

      const historyModels = results.models
      expect(historyModels).to.have.length(2)
      const history = historyModels.find((m) => {
        return m.get('operation') === 'updated' && m.get('sequence') === 2
      })
      expect(history).to.exist()
      expect(JSON.parse(history.get('data')).name).to.equal('changed')
    })
  })

  lab.test('it uses latest sequence when none is provided', async () => {
    const model = await Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    }).save()
    await model.set('name', 'changed').save()
    await model.set('name', 'changed2').save(null, { history: false })
    await Test.revert(model.id)
    const revertedModel = await Test.forge({ id: model.id }).fetch()

    expect(model.get('name')).to.equal('changed2')
    expect(revertedModel.get('name')).to.equal('changed')
  })

  lab.test('it works with json datatypes on postgres', async () => {
    const History = bookshelf.Model.extend({ tableName: 'history_json' })
    const Test = bookshelf.Model.extend({
      tableName: 'test',
      history: {
        model: History
      }
    })

    const model = await Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    }).save()

    await model.set('name', 'changed').save()
    await Test.revert(model.id, 1)
    const revertedModel = await Test.forge({ id: model.id }).fetch()
    const results = await History.where({
      resource_type: model.tableName,
      resource_id: model.id
    }).fetchAll()

    const historyModels = results.models
    expect(historyModels).to.have.length(2)
    const history = historyModels.find((m) => {
      return m.get('operation') === 'updated' && m.get('sequence') === 2
    })
    expect(history).to.exist()
    expect(history.get('data').name).to.equal('changed')
    expect(revertedModel.get('name')).to.equal('John Doe')
    expect(Test.historyModel() === History).to.be.true()
  })
})

lab.describe('history', () => {
  lab.test('it works', async () => {
    const Test = bookshelf.Model.extend({ tableName: 'test', history: { autoHistory: false } })

    const model = await Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    }).save()
    await Test.history(model, true, 'manual')
    const results = await History.where({
      resource_type: model.tableName,
      resource_id: model.id
    }).fetchAll()
    const historyModels = results.models
    expect(historyModels).to.have.length(1)
    expect(historyModels[0].get('patch')).to.be.true()
    expect(historyModels[0].get('operation')).to.equal('manual')
    expect(JSON.parse(historyModels[0].get('data')).name).to.equal('John Doe')
  })
})
