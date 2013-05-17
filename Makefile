.PHONY: test all

all: lib/defs.js

lib/defs.js: bin/generate-defs.js bin/amqp-rabbitmq-0.9.1.json
	(cd bin; node ./generate-defs.js > ../lib/defs.js)

test: lib/defs.js
	./node_modules/mocha/bin/mocha --ui tdd test

bin/amqp-rabbitmq-0.9.1.json:
	curl https://raw.github.com/rabbitmq/rabbitmq-codegen/rabbitmq_v3_1_0/amqp-rabbitmq-0.9.1.json > $@
