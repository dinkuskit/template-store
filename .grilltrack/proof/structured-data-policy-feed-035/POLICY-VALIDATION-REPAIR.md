# Policy projection validation repair

Reviewed source: `7e278d7fcd8434eceb9685ca0d0a33bf92291572`.

Accepted finding (`required_fix`): the consumer checked record identity and
revision but trusted optional fields and shipping cross-field shape. Flat
shipping without an amount and unknown return enums could reach page text or
Product JSON-LD. The focused reproduction had 23 failing cases before repair.

The consumer now uses Commerce's exported `normalizeMoney` for USD amounts.
The pinned Commerce policy input normalizers are not public exports, and its
public readers validate only envelopes. The remaining local checks therefore
validate the public record shape: flat shipping requires an amount; free
shipping allows no amount or zero; country lists, min/max day bounds, URLs,
return enums, and optional day integers must match the pinned contract.
It does not add return-category/day business rules absent from Commerce.

Null policies, an empty return record, omitted optionals, zero amounts/days,
and configured valid optional fields remain accepted. Both public-dispatch
and native-development fallback reads pass through the same decoder. Malformed
public payloads do not trigger native fallback. Existing callers catch a
rejected projection and omit policy text/JSON-LD through their existing path.

Focused tests cover malformed optional fields and cross-field shape, valid
minimal/full records, public rejection, and native rejection. Current command
results and source hashes are recorded in `PROOF.md` and
`source-manifest.sha256`. No Commerce source or public API was changed.
