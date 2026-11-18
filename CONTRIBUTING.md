# Contributing

Keep changes focused and document any change to file-format or normalization
semantics. Use synthetic inputs for examples and tests. Do not attach private
fit files, personal paths, credentials or experimental datasets to public issues.

Run `npm test` and the browser checks for viewer changes. Run the native tests
with PyROOT for saving/decomposition changes. Update the Data guide's copied
Python code from the current helper when the saver changes; tests compare the
actual copied code with the API implementation.

Generated build products, dependency directories, local outputs and test reports
are excluded from source control. Dependency licenses and author notices must
remain in both source and offline distributions. Project code uses MIT.
