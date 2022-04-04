hey here's a contentapi to matrix bridge

i mostly just followed [this](https://github.com/matrix-org/matrix-appservice-bridge/blob/develop/HOWTO.md) and made it interface with contentapi

other references:
- [the slack bridge](https://github.com/matrix-org/matrix-appservice-slack)

usage:

```sh
mkdir data # if it doesn't already exist
node . -r -u "http://url-to-appservice:port" # the url here is how the homeserver will try to access the appservice

# or with docker
docker build -t mxcapi .
docker run --rm -v $PWD/data:/appservice/data mxcapi -r -u "http://url-to-appservice:port"
```
this generates a registration file `data/capi-registration.yaml` that you use to register the bridge with a matrix homeserver  
the url needs to be how the homeserver can contact the appservice  
then install the app service like [this](https://docs.mau.fi/bridges/general/registering-appservices.html)

then make a `data/capi.yaml` file like
```yaml
capi_url: http://localhost:5000 # url to contentapi instance
capi_user: username
capi_pass: password
homeserver_url: http://localhost:6167 # http(s) url to homeserver
homeserver: localhost:6167 # what appears in the second half of matrix IDs
admins: ["@user:server", "@user2:server"] # what users are allowed to bind rooms
```
and run
```sh
node . -p 9999 -c data/capi.yaml
# the port needs to be the same one from the previous node command

# or with docker
docker run -v $PWD/data:/appservice/data mxcapi -p 9999 -c data/capi.yaml
```

that should be it.


if you're running [synapse through docker-compose](https://github.com/matrix-org/synapse/blob/master/contrib/docker/docker-compose.yml), you can probably do this:
```sh
docker build -t mxcapi /path/to/this/repo
# run in the same folder as your docker-compose file
mkdir data
docker run --rm -v $PWD/data:/appservice/data mxcapi -r -u "http://mxcapi:8000"
```
use `homeserver_url: http://synapse:8008` in `data/capi.yaml`  
then insert this snippet into your `docker-compose.yaml`
```yaml
# in synapse's volumes section
    - ./data/capi-registration.yaml:/data/capi-registration.yaml
# as a new service
mxcapi:
  image: mxcapi
  volumes:
    - ./data:/appservice/data
```
make sure to edit synapse's config to add
```yaml
app_service_config_files:
  - /data/capi-registration.yaml
```
