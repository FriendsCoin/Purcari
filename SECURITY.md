# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Which versions are eligible for receiving such patches depends on the CVSS v3.0 Rating:

| Version | Supported          |
| ------- | ------------------ |
| 2.x.x   | :white_check_mark: |
| < 2.0   | :x:                |

## Reporting a Vulnerability

Please report security vulnerabilities by emailing security@purcari.wine.

**Please do not report security vulnerabilities through public GitHub issues.**

You should receive a response within 48 hours. If for some reason you do not, please follow up via email to ensure we received your original message.

Please include the following information in your report:

- Type of issue (e.g. buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

## Security Best Practices

When contributing to this project:

### Input Validation
- Always validate and sanitize user input
- Use the validation utilities in `src/utils/validation.ts`
- Never trust client-side data

### XSS Prevention
- Use the `sanitizeInput()` function for user-generated content
- Avoid using `dangerouslySetInnerHTML` unless absolutely necessary
- Validate and escape all dynamic content

### File Uploads
- Validate file types and sizes
- Use the `validateCSVFile()` and `validateFileSize()` functions
- Never execute uploaded files

### API Security
- Always use HTTPS in production
- Implement rate limiting for API endpoints
- Validate all API inputs and outputs

### Dependencies
- Regularly update dependencies
- Review security advisories
- Use `npm audit` to check for vulnerabilities

### Environment Variables
- Never commit `.env` files
- Use `.env.example` as a template
- Keep sensitive data out of the repository

### Authentication & Authorization
(For future implementations)
- Use strong password policies
- Implement proper session management
- Follow OWASP authentication guidelines

## Disclosure Policy

When we receive a security bug report, we will:

1. Confirm the problem and determine the affected versions
2. Audit code to find any similar problems
3. Prepare fixes for all supported versions
4. Release new security patch versions

## Comments on this Policy

If you have suggestions on how this process could be improved, please submit a pull request.
