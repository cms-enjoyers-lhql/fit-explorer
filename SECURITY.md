# Security and data handling

Fit files are read locally in the browser. The built viewer has no upload API,
analytics or native-code execution route. It reads native display tables and does
not execute RooWorkspace or custom PDF code.

ROOT can retain filenames and filesystem metadata when a file is saved. Review
files before publishing them. The supplied synthetic example is rewritten with
a clean relative filename and checked for personal metadata.

Only open files from sources you trust in native ROOT/PyROOT tools. Custom PDF
code belongs to the native fitting environment, not the browser renderer.

For security reports, use the repository's private vulnerability-reporting
feature when available. Avoid publishing credentials, personal data or private
ROOT files in an issue. A minimal synthetic reproducer is preferred.
