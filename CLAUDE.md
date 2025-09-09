# Project-Specific Guidelines for amqplib

## Generated Files - DO NOT EDIT
- `lib/defs.js` - This file is generated code. NEVER modify it directly.
  - Generated via `make lib/defs.js` from the AMQP specification
  - If linting issues arise, exclude this file from linting rules rather than modifying it

## Commit Requirements
- NEVER commit when tests are failing
- NEVER commit when there are lint errors
- Always run `npm test` and `npm run lint` before committing
- If tests are failing, investigate and fix the issue before proceeding