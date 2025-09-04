Please follow the following process when I ask you to enfore a new lint rule using /lint-enforce $rule

1. Create and change to a new branch. Ask for the branch name.
2. Configure the rule to error in biome.json
3. Run lint (npm run lint). If there are NO errors, goto step 9
4. If there are no errors goto X
5. Use biome to SAFELY auto fix (npm run lint -- --fix). If there are errors stop and ask for instruction.
7. Run the tests (npm test). If there are errors, stop and ask for instruction.
8. If the rule defaults to error, delete it (See https://biomejs.dev/linter/javascript/rules/ for rule details)
9. Update the project changelog
10. Add the changes
11. Commit the changes
12. Push the changes
