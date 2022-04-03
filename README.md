hey here's a contentapi to matrix bridge

i mostly just followed [this](https://github.com/matrix-org/matrix-appservice-bridge/blob/develop/HOWTO.md) and made it interface with contentapi

other references:
- [the slack bridge](https://github.com/matrix-org/matrix-appservice-slack/blob/develop/src/Main.ts)

usage um  
```sh
node . -r -u "http://url-to-the-thing:port"
```
generates a registration file `capi-registration.yaml` that you use to register the bridge with a matrix homeserver  
the url needs to be how the homeserver can contact the appservice  
then install the app service like [this](https://docs.mau.fi/bridges/general/registering-appservices.html)

then make a `capi.yaml` file like
```yaml
token: aaaaaaa # contentapi token
capi_url: http://localhost:5000 # optional, url to contentapi instance
homeserver_url: http://localhost:6167 # http(s) url to homeserver
homeserver: localhost:6167 # what appears in the second half of matrix IDs
```
and run
```sh
node . -p 9999 -c capi.yaml
# the port needs to be the same one from the previous node command
```

that should be it.