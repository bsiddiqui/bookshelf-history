'use strict'

let Lab = require('lab')
let lab = exports.lab = Lab.script()
let Code = require('code')
let expect = Code.expect
let knex = require('knex')(require('./knexfile').development)
let bookshelf = require('bookshelf')(knex)

bookshelf.plugin(require('../'))
let Test = bookshelf.Model.extend({ tableName: 'test', history: true })
let History = Test.historyModel()

lab.before(done => knex.migrate.latest().then(() => done(), done))

lab.experiment('general testing', () => {
  lab.test('should run with default arguments', done => {
    Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    })
    .save()
    .then(model => model.set('name', 'Jonny').save())
    .then(model => History.where({
      resource_type: model.tableName,
      resource_id: model.id
    }).fetchAll())
    .then(models => {
      expect(models).to.have.length(2)
      expect(models.findWhere({ operation: 'created', sequence: 1 })).to.exist()
      expect(JSON.parse(models.findWhere({ operation: 'created', sequence: 1 }).get('data')).name).to.equal('John Doe')
      expect(models.findWhere({ operation: 'updated', sequence: 2 })).to.exist()
      expect(JSON.parse(models.findWhere({ operation: 'updated', sequence: 2 }).get('data')).name).to.equal('Jonny')
    })
    .then(done, done)
  })

  lab.test('should detect patch operation', done => {
    Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    })
    .save()
    .then(model => model.save({ name: 'Jonny' }, { patch: true }))
    .then(model => History.where({
      resource_type: model.tableName,
      resource_id: model.id
    }).fetchAll())
    .then(models => {
      expect(models).to.have.length(2)
      expect(models.findWhere({ operation: 'created', sequence: 1 })).to.exist()
      expect(JSON.parse(models.findWhere({ operation: 'created', sequence: 1 }).get('data')).name).to.equal('John Doe')
      expect(models.findWhere({ operation: 'updated', sequence: 2 })).to.exist()
      expect(models.findWhere({ operation: 'updated', sequence: 2 }).get('patch')).to.be.true()
      expect(JSON.parse(models.findWhere({ operation: 'updated', sequence: 2 }).get('data')).name).to.equal('Jonny')
    })
    .then(done, done)
  })

  lab.test('should not hook when history is disabled', done => {
    let Test = bookshelf.Model.extend({ tableName: 'test', history: false })

    Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    })
    .save()
    .then(model => History.where({
      resource_type: model.tableName,
      resource_id: model.id
    }).fetchAll())
    .then(models => {
      expect(Test.historyModel()).to.be.false()
      expect(models).to.have.length(0)
    })
    .then(done, done)
  })

  lab.test('should not backup when options.history is false', done => {
    Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    })
    .save()
    .then(model => model.set('name', 'changed').save(null, { history: false }))
    .then(model => History.where({
      resource_type: model.tableName,
      resource_id: model.id
    }).fetchAll())
    .then(models => {
      expect(models).to.have.length(1)
      expect(models.findWhere({ operation: 'created', sequence: 1 })).to.exist()
      expect(models.findWhere({ operation: 'updated' })).to.not.exist()
    })
    .then(done, done)
  })
})

lab.experiment('backup', () => {
  lab.test('should work', done => {
    let Test = bookshelf.Model.extend({ tableName: 'test', history: { autoHistory: false } })

    Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    })
    .save()
    .tap(model => Test.backup(model.id))
    .then(model => History.where({
      resource_type: model.tableName,
      resource_id: model.id
    }).fetchAll())
    .then(models => {
      expect(models).to.have.length(1)
      expect(models.findWhere({ operation: 'manual', sequence: 1 })).to.exist()
    })
    .then(done, done)
  })

  lab.test('should accept running transactions', done => {
    let Test = bookshelf.Model.extend({ tableName: 'test', history: { autoHistory: false } })

    bookshelf.transaction(transacting => {
      return Test.forge({
        name: 'John Doe',
        email: 'johndoe@gmail.com'
      })
      .save(null, { transacting })
      .tap(model => Test.backup(model.id, { transacting }))
      .then(model => History.where({
        resource_type: model.tableName,
        resource_id: model.id
      }).fetchAll({ transacting }))
      .then(models => {
        expect(models).to.have.length(1)
        expect(models.findWhere({ operation: 'manual', sequence: 1 })).to.exist()
      })
    })
    .then(() => done(), done)
  })
})

lab.experiment('revert', () => {
  lab.test('should work', done => {
    Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    })
    .save()
    .then(model => model.set('name', 'changed').save())
    .tap(model => Test.revert(model.id, 1))
    .then(model => Test.forge({ id: model.id }).fetch())
    .then(model => {
      return [
        History.where({
          resource_type: model.tableName,
          resource_id: model.id
        }).fetchAll(),
        Test.forge({ id: model.id }).fetch()
      ]
    })
    .spread((histories, test) => {
      expect(histories).to.have.length(2)
      expect(JSON.parse(histories.findWhere({ operation: 'updated', sequence: 2 }).get('data')).name).to.equal('changed')
      expect(test.get('name')).to.equal('John Doe')
    })
    .then(done, done)
  })

  lab.test('should accept running transactions', done => {
    bookshelf.transaction(transacting => {
      return Test.forge({
        name: 'John Doe',
        email: 'johndoe@gmail.com'
      })
      .save(null, { transacting })
      .then(model => model.set('name', 'changed').save(null, { transacting }))
      .tap(model => Test.revert(model.id, 1, { transacting }))
      .then(model => Test.forge({ id: model.id }).fetch({ transacting }))
      .then(model => {
        return [
          History.where({
            resource_type: model.tableName,
            resource_id: model.id
          }).fetchAll({ transacting }),
          Test.forge({ id: model.id }).fetch({ transacting })
        ]
      })
      .spread((histories, test) => {
        expect(histories).to.have.length(2)
        expect(JSON.parse(histories.findWhere({ operation: 'updated', sequence: 2 }).get('data')).name).to.equal('changed')
        expect(test.get('name')).to.equal('John Doe')
      })
    })
    .then(() => done(), done)
  })

  lab.test('should use latest sequence when none is provided', done => {
    Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    })
    .save()
    .then(model => model.set('name', 'changed').save())
    .then(model => model.set('name', 'changed2').save(null, { history: false }))
    .tap(model => Test.revert(model.id))
    .then(model => Test.forge({ id: model.id }).fetch())
    .then(model => {
      return [
        History.where({
          resource_type: model.tableName,
          resource_id: model.id
        }).fetchAll(),
        Test.forge({ id: model.id }).fetch()
      ]
    })
    .spread((histories, test) => {
      expect(histories).to.have.length(2)
      expect(JSON.parse(histories.findWhere({ operation: 'updated', sequence: 2 }).get('data')).name).to.equal('changed')
      expect(test.get('name')).to.equal('changed')
    })
    .then(done, done)
  })

  lab.test('should also work with json datatypes on postgres', done => {
    let History = bookshelf.Model.extend({ tableName: 'history_json' })
    let Test = bookshelf.Model.extend({
      tableName: 'test',
      history: {
        model: History
      }
    })

    Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    })
    .save()
    .then(model => model.set('name', 'changed').save())
    .tap(model => Test.revert(model.id, 1))
    .then(model => Test.forge({ id: model.id }).fetch())
    .then(model => {
      return [
        History.where({
          resource_type: model.tableName,
          resource_id: model.id
        }).fetchAll(),
        Test.forge({ id: model.id }).fetch()
      ]
    })
    .spread((histories, test) => {
      expect(histories).to.have.length(2)
      expect(histories.findWhere({ operation: 'updated', sequence: 2 }).get('data').name).to.equal('changed')
      expect(test.get('name')).to.equal('John Doe')
      expect(Test.historyModel() === History).to.be.true()
    })
    .then(done, done)
  })
})

lab.experiment('history', () => {
  lab.test('should work', done => {
    let Test = bookshelf.Model.extend({ tableName: 'test', history: { autoHistory: false } })

    Test.forge({
      name: 'John Doe',
      email: 'johndoe@gmail.com'
    })
    .save()
    .tap(model => Test.history(model, true, 'manual'))
    .then(model => History.where({
      resource_type: model.tableName,
      resource_id: model.id
    }).fetchAll())
    .then(models => {
      expect(models).to.have.length(1)
      expect(models.at(0).get('patch')).to.be.true()
      expect(models.at(0).get('operation')).to.equal('manual')
      expect(JSON.parse(models.at(0).get('data')).name).to.equal('John Doe')
    })
    .then(done, done)
  })
})
