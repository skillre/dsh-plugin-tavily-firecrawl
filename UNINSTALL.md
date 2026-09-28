# Uninstall and rollback

Remove the bundle from a profile:

```sh
dsh plugin --profile <profile> remove @skillre/dsh-plugin-tavily-firecrawl
```

Roll back to a known-good version:

```sh
dsh plugin --profile <profile> remove @skillre/dsh-plugin-tavily-firecrawl
dsh plugin --profile <profile> add @skillre/dsh-plugin-tavily-firecrawl@<known-good-version>
```

Then inspect and start the profile:

```sh
dsh --profile <profile> --dump-config
dsh --profile <profile>
```

If the plugin prevents the Web GUI from starting, perform recovery from the CLI; do not depend on the GUI being available.

Removing the package removes its Bundle layer. Document separately any user-owned files or external resources that an implemented plugin deliberately leaves behind.
