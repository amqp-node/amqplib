Please follow the following process when I ask you to enable a lint rule using /lint-enable $rule

1. Create and change to a new branch. Ask for the branch name.
2. Configure the rule to error in biome.json
3. Run lint (npm run lint). If there are NO errors, goto step 8
4. Use biome to SAFELY auto fix (npm run lint -- --fix). If there are errors stop and ask for instruction.
5. Run the tests (npm test). If there are errors, stop and ask for instruction.
6. If the rule defaults to error, delete it (See https://biomejs.dev/linter/javascript/rules/ for rule details)
7. Update the project changelog
8. Add the changes
9. Commit the changes
10. Push the changes
