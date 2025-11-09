# Contributing to Purcari Biodiversity Dashboard

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for all contributors.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/Purcari.git`
3. Install dependencies: `npm install`
4. Create a feature branch: `git checkout -b feature/your-feature-name`

## Development Workflow

### Before Making Changes

```bash
# Ensure you're on the latest main branch
git checkout main
git pull origin main

# Create a new feature branch
git checkout -b feature/your-feature-name
```

### Making Changes

1. Write clean, well-documented code
2. Follow the existing code style (enforced by ESLint and Prettier)
3. Add tests for new features
4. Update documentation as needed

### Code Style

- We use ESLint and Prettier for code formatting
- Run `npm run lint:fix` before committing
- Run `npm run format` to format your code
- TypeScript strict mode is enabled - add proper types

### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new species filter
fix: correct map marker positioning
docs: update README with installation steps
style: format code with prettier
refactor: reorganize component structure
test: add tests for data processing
chore: update dependencies
```

### Submitting Changes

1. Ensure all tests pass: `npm test`
2. Ensure linting passes: `npm run lint`
3. Commit your changes with a descriptive message
4. Push to your fork: `git push origin feature/your-feature-name`
5. Create a Pull Request

## Pull Request Process

1. **Title**: Use a clear, descriptive title
2. **Description**: Explain what changes you made and why
3. **Testing**: Describe how you tested your changes
4. **Screenshots**: Include screenshots for UI changes
5. **Breaking Changes**: Clearly mark any breaking changes

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] Tests added/updated and passing
- [ ] Documentation updated
- [ ] No console errors or warnings
- [ ] Commits follow conventional commit format
- [ ] Branch is up to date with main

## Bug Reports

When filing a bug report, include:

1. **Description**: Clear description of the bug
2. **Steps to Reproduce**: Detailed steps to reproduce the issue
3. **Expected Behavior**: What you expected to happen
4. **Actual Behavior**: What actually happened
5. **Environment**: Browser, OS, Node version
6. **Screenshots**: If applicable

## Feature Requests

When suggesting a feature:

1. **Use Case**: Explain why this feature would be useful
2. **Proposed Solution**: Describe how you envision it working
3. **Alternatives**: Any alternative solutions you've considered
4. **Additional Context**: Any other relevant information

## Project Structure

```
src/
├── components/     # React components
├── hooks/          # Custom hooks
├── services/       # API and data services
├── types/          # TypeScript types
├── utils/          # Utility functions
└── __tests__/      # Test files
```

## Testing Guidelines

- Write unit tests for utility functions
- Write integration tests for components
- Aim for >70% code coverage
- Test edge cases and error conditions

## Documentation

- Add JSDoc comments to functions
- Update README for new features
- Document complex algorithms
- Keep examples up to date

## Questions?

Feel free to open an issue for any questions about contributing.

Thank you for contributing to Purcari Biodiversity Dashboard! 🌿
