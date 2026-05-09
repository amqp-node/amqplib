RABBITMQ_SRC_VERSION=v3.12.13
JSON=amqp-rabbitmq-0.9.1.json
AMQP_JSON=https://raw.githubusercontent.com/rabbitmq/rabbitmq-server/$(RABBITMQ_SRC_VERSION)/deps/rabbitmq_codegen/$(JSON)

NODEJS_VERSIONS='18.20.0' '20.10.0' '22.14.0' '24.7.0'

UGLIFY=./node_modules/.bin/uglifyjs

.PHONY: test test-all-nodejs coverage lib/defs.js

error:
	@echo "Please choose one of the following targets: test, test-all-nodejs, coverage, lib/defs.js"
	@exit 1

test:
	node --test --test-reporter=spec

test-all-nodejs:
	for v in $(NODEJS_VERSIONS); \
		do echo "-- Node version $$v --"; \
		nave use $$v node --test --test-reporter=spec; \
		done

coverage:
	node --test --test-coverage --test-reporter=spec

lib/defs.js: clean bin/generate-defs test

clean:
	rm -f lib/defs.js bin/amqp-rabbitmq-0.9.1.json

bin/generate-defs: $(UGLIFY) bin/generate-defs.js bin/amqp-rabbitmq-0.9.1.json
	(cd bin; node ./generate-defs.js > ../lib/defs.js)
	$(UGLIFY) ./lib/defs.js -o ./lib/defs.js \
		-c 'sequences=false' --comments \
		-b 'indent-level=2' 2>&1 | (grep -v 'WARN' || true)

bin/amqp-rabbitmq-0.9.1.json:
	curl -L $(AMQP_JSON) > $@

$(UGLIFY):
	npm install
