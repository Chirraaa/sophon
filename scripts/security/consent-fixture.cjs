module.exports = function driveConsent(app, decision) {
  app.on('web-contents-created', (_event, contents) => {
    const send = contents.send.bind(contents)
    contents.send = (channel, ...args) => {
      send(channel, ...args)
      if (channel !== 'consent:changed' || !args[0]) return
      const id = args[0].id
      void Promise.resolve(decision()).then((allow) => {
        if (contents.isDestroyed()) return
        return contents
          .executeJavaScript(`window.api.consent.resolve(${JSON.stringify(id)}, ${allow === true})`)
          .catch(() => {})
      })
    }
  })
}
