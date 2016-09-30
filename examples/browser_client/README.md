# Browser Client and WebSocket Tunnel Example

This example demonstrates a browser-based AMQP connection tunneled through a transparent WebSocket proxy. It contains two essential JavaScript components:

  - `server.js`: The NodeJS tunneling WebSocket server
  - `web/main.js`: The browser JavaScript AMQP client (Chrome tested only)

##Running
* Ensure `browserify` is installed on your system
* Ensure RabbitMQ is installed and running on a well known host
* Run `npm install`
* Set the configuration parameters according to your broker configuration in both `web/main.js`:
  ```javascript
  var amqpConfig = {
    tunnelHost: '<The hostname server.js is bound>',
    tunnelPort: '<The port server.js is boun>',
    username: '<RabbitMQ client username>',
    password: '<RabbitMQ client password>'
  };
  ```
  and in `server.js`, for the broker URL:
  ```javascript
  var config = {
    rabbitMqUrl: 'amqp://<broker username>:<broker password>@<broker host>:<broker port>/'
  };
  ```
* From `web/` run `browserify main.js -o bundle.js`
  * *Removing the dependency on `browserify` would be awesome!*
* Run `node server.js --port <Port to listen on>`
  * Or without arguments, the default port is `1234`
* Navigate to `web/client.html` in a web browser

##Goals
* Remove the dependency on `browserify`
  * It'd be nice to have a native browser compatible AMQP client library.
* Fix the import errors related to using `browserify` (see `frame.js`)
