# Required successor-recovery fix

Reviewed prior source: git:27c3579802bbe9251a87f9677b1b98149b6e63f7.

After an authoritative release, start may create the successor while its response is lost. Keeping the original attempt locator and querying it again returns the released parent, which can incorrectly re-enable browser retry while the successor remains pending. Commerce continues to own the frozen attempt and all order/payment effects; this is a browser recovery sequencing defect.

Required fix: persist an opaque recovery marker before issuing start. While the response remains unknown, status queries the same capability's current attempt without the old hint. Only authoritative status/start clears the marker and retains the current server-issued attempt. A fresh prepare never replaces the capability; reload does not allow another start before status. The regression test covers released-parent timeout, reload and discovery of a pending successor. The immutable package/client proof loses the response after actual Core start and recovers before settlement.

Earlier external evidence for the prior source cannot qualify the repaired candidate. New exact-source CI and comprehensive OpenClaw/native evidence is required after push.
