COMMIT_OR_BRANCH=a334b711ad37493cdccdd141079c4af974a9b054
JSON=amqp-rabbitmq-0.9.1.json
AMQP_JSON_LOCATION=https://raw.githubusercontent.com/rabbitmq/rabbitmq-server/$(COMMIT_OR_BRANCH)/deps/rabbitmq_codegen/$(JSON)

NODEJS_VERSIONS='0.8' '0.9' '0.10' '0.11' '0.12' '1.8.4' '2.5' '3.3' '4.9' '5.12' '6.17' '8.17' '9.11' '10.21' '11.15' '12.18' '13.14' '14.5' '15.8'

MOCHA=./node_modules/.bin/mocha
_MOCHA=./node_modules/.bin/_mocha
UGLIFY=./node_modules/.bin/uglifyjs
ISTANBUL=./node_modules/.bin/istanbul

.PHONY: test test-all-nodejs all clean coverage

all: lib/defs.js

clean:
	rm lib/defs.js bin/$(JSON)
	rm -rf ./coverage

lib/defs.js: $(UGLIFY) bin/generate-defs.js bin/$(JSON)
	(cd bin; node ./generate-defs.js > ../lib/defs.js)
	$(UGLIFY) ./lib/defs.js -o ./lib/defs.js \
		-c 'sequences=false' --comments \
		-b 'indent-level=2' 2>&1 | (grep -v 'WARN' || true)

test: lib/defs.js
	$(MOCHA) --check-leaks -u tdd test/

test-all-nodejs: lib/defs.js
	for v in $(NODEJS_VERSIONS); \
		do echo "-- Node version $$v --"; \
		nave use $$v $(MOCHA) -u tdd -R progress test; \
		done

coverage: $(ISTANBUL) lib/defs.js
	$(ISTANBUL) cover $(_MOCHA) -- -u tdd -R progress test/
	$(ISTANBUL) report
	@echo "HTML report at file://$$(pwd)/coverage/lcov-report/index.html"

bin/amqp-rabbitmq-0.9.1.json:
	curl -L $(AMQP_JSON_LOCATION) > $@

$(ISTANBUL):
	npm install

$(UGLIFY):
	npm install
