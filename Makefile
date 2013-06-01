RABBITMQ_SRC_VERSION=rabbitmq_v3_1_1
JSON=amqp-rabbitmq-0.9.1.json
RABBITMQ_CODEGEN=https://raw.github.com/rabbitmq/rabbitmq-codegen

.PHONY: test all

all: lib/defs.js

lib/defs.js: bin/generate-defs.js bin/amqp-rabbitmq-0.9.1.json
	(cd bin; node ./generate-defs.js > ../lib/defs.js)

test: lib/defs.js
	./node_modules/mocha/bin/mocha --ui tdd test

bin/amqp-rabbitmq-0.9.1.json:
	curl $(RABBITMQ_CODEGEN)/$(RABBITMQ_SRC_VERSION)/$(JSON) > $@
