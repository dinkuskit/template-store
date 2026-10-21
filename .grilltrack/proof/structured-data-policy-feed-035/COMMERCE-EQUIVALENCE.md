# Commerce source equivalence

Current prepared pin: `288199275f61aec084c0e1e72b370ec74ea35369`.
Previous pin: `c61d63647b3eb7f990d935f170dd93eb6d1c56dd`.

The following read-only check returned exit code 0 with no diff in the Commerce
repository:

```sh
git diff --exit-code c61d63647b3eb7f990d935f170dd93eb6d1c56dd 288199275f61aec084c0e1e72b370ec74ea35369 -- src package.json package-lock.json emdash-plugin.jsonc scripts cli bin
```

Both revisions have the same Git object for each checked path:

| Path | Identical object |
| --- | --- |
| `src` | `09137252b8b096ce1c812b5272b1461efa3b3ae1` |
| `package.json` | `a5c34818a138af40a4f4f120a987829d7f84b205` |
| `package-lock.json` | `d605a1f8489ddb4ad0e84934106db9ff746ae5b1` |
| `emdash-plugin.jsonc` | `6a6106c3b6c8f4a3fb4076f6886484ce11babdbd` |
| `scripts` | `97a5c7ca4c59986c292c2349670839b1d2d410b5` |
| `cli` | `8ced1125d2fbb0517d7633d44bcd7b1034cdc764` |
| `bin` | `b22682ea7e6078146d47c1949499f5c2610d7a12` |

The intervening Commerce commit changes tests and proof/ledger records only.
Template source preparation checked out the current pin exactly; this does not
claim a released package or Registry installation. The return-label change in
the Template Store is covered by its own current targeted proof.
