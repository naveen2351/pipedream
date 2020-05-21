const dropbox = require('https://github.com/PipedreamHQ/pipedream/components/dropbox/dropbox.app.js')

module.exports = {
  name: "new-file",
  props: {
    dropbox,
    path: { propDefinition: [dropbox, "path"]},
    recursive: { propDefinition: [dropbox, "recursive"]},
    dropboxApphook: {
      type: "$.interface.apphook",
      appProp: "dropbox",
    },
    db: "$.service.db",
  },
  hooks: {
    async activate() {
      await initState(this)
    }
  },
  async run(event) {
    const lastFileModTime = this.db.get("last_file_mod_time")
    let currFileModTime = ""
    let updates = await getUpdates(this)
    for(update of updates) {
      if (update[".tag"] == "file") {
        if (update.server_modified > currFileModTime) {
          currFileModTime = update.server_modified
        }
        try {
          let revisions = await this.dropbox.sdk().filesListRevisions({
            path: update.id,
            mode: { ".tag": "id" },
            limit: 10,
          })
          if (revisions.entries.length > 1) {
            let oldest = revisions.entries.pop()
            if (lastFileModTime && lastFileModTime >= oldest.client_modified) {
              continue
            }
          }
        } catch(err) {
          console.log(err)
          throw(`Error looking up revisions for file: ${update.name}`)
        }
        this.$emit(update)
      }
    }
    if (currFileModTime != "") {
      this.db.set("last_file_mod_time", currFileModTime)
    }
  },
}

async function initState(context) {
  const { path, recursive, dropbox, db } = context
  try {
    let startTime = new Date()
    let fixedPath = (path == "/" ? "" : path)
    let { cursor } = await dropbox.sdk().filesListFolderGetLatestCursor({ path: fixedPath, recursive })
    const state = { path, recursive, cursor }
    db.set("dropbox_state", state)
    db.set("last_file_mod_time", startTime)
    return state
  } catch(err) {
    console.log(err)
    throw(`Error getting latest cursor for folder: ${path}${recursive ? " (recursive)" : ""}`)
  }
}

async function getState(context) {
  const { path, recursive, dropbox, db } = context
  let state = db.get("dropbox_state")
  if (state == null || state.path != path || state.recursive != recursive) {
    state = await initState(context)
  }
  return state
}

async function getUpdates(context) {
  let ret = []
  const state = await getState(context)
  if (state) {
    try {
      const { dropbox, db } = context
      let [cursor, has_more, entries] = [state.cursor, true, null]
      while(has_more) {
        ({ entries, cursor, has_more } = await dropbox.sdk().filesListFolderContinue({ cursor }))
        ret = ret.concat(entries)
      }
      state.cursor = cursor
      db.set("dropbox_state", state)
    } catch(err) {
      console.log(err)
      throw(`Error getting list of updated files/folders for cursor: ${state.cursor}`)
    }
  }
  return ret
}
