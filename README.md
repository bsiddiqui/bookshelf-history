# bookshelf-history

**bookshelf-history** is a plugin for Bookshelf.js that lets you easily handle
row backup and restoration. Even automatic backup is supported.

### Usage

```javascript
// Just plug History in bookshelf
bookshelf.plugin(require('bookshelf-history'))

// Now create your model as usual setting the property history to true to allow
// custom methods to work properly and enable automatic backup
let User = bookshelf.Model.extend({ tableName: 'users', history: true })
```

### Methods

* `Model.backup(resourceId, [options])` perform a manual backup on a model that
has history enabled. `resourceId` must be the ID from the row to be backed up
and `options` is an optional object where you can pass a transaction object as
`options.transacting`.
* `Model.revert(resourceId, [sequence], [options])` restores a resource to a
specific back-up sequence. If no `sequence` is provided the resource will be
restored to the latest known sequence. `options` is an optional object where you
can pass a transaction object as `options.transacting`.
* `Model.historyModel()` returns the history model being used for query operations
in the Model or `false` if history is disabled.

### Default options

```javascript
let defaults = {
  fields: {
    sequence: Integer,
    resource_id: Any,
    resource_type: String,
    metadata: Object,
    diff: Object,
    data: Object,
    patch: Boolean,
    operation: String,
    getMetadata: Function
  },
  model: bookshelf.Model.extend({ tableName: 'history' })
  autoHistory: [ 'created', 'updated' ],

}
```

These options can be globally overwritten when adding the plugin to bookshelf

```javascript
bookshelf.plugin(require('bookshelf-history'), {
  fields: {
    sequence: 'version',
    data: 'row_content'
  },
  model: bookshelf.Model.extend({ tableName: 'backups' })
})
```

Or also when creating each subsequent model

```javascript
let User = bookshelf.Model.extend({
  tableName: 'user',
  history: {
    autoHistory: false
  }
})
```

### Additional Metadata

History now supports a `getMetadata(model)` option that will allow you to implement a function
to return additional key value pairs to be stored with the history.  In the example below,
we use the [continuation pattern](https://www.npmjs.com/package/cls-hooked),
to fetch the logged in user / admin who initiated a HTTP request that is mutating the model.
The data is saved as `metadata` in the `History` table.

```
const getNamespace = require('cls-hooked').getNamespace
const localStorage = getNamespace('app')
```

```
history: {
  getMetadata: () => {
    if (!localStorage) {
      return
    }

    return {
      author_id: localStorage.get('author_id'),
      author_type: localStorage.get('author_type')
    }
  }
}
```


### Migration

Below is an example migration. All fields are required with the exception of `created_at`.
You can also specify custom field names using the configuration as shown in the section above.

History also supports `JSON` and `JSONB` field types out of the box for the `data`
field when running with PostgreSQL. With other databases the `data` field gets
stringifyed with `JSON.stringify()` so make sure your `data` field is long
enough to store all data you need.

```javascript
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
```


### Bypassing backups

If you want to perform an operation inside a History enabled model but don't
want to trigger an automatic backup you can make it two ways:

```javascript
// Disable automatic backups entirely for the model
let User = bookshelf.Model.extend({
  tableName: 'users',
  history: {
    autoHistory: false
  }
})

// Or disable for a single operation
User.forge({
  name: 'John',
  email: 'john@doe.com'
})
.save(null, { history: false })
```

### Testing

```
cd ./bookshelf-history
npm install
```

In `.env` place the DATABASE_URL that will be used for tests. Or you can pass it on the command line.

```
DATABASE_URL=postgres://postgres:postgres@localhost/bookshelf_history npm test
```
