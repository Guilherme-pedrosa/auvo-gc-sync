# Content from https://auvoapiv2.docs.apiary.io/api-description-document

FORMAT: 1A
HOST: https://api.auvo.com.br/v2

\# Auvo API V2.0

Auvo API provides a representation of the data found in your account at \[Auvo\](https://auvo.com.br).
We follow \*\*REST\*\* principles, so the API is stateless and http methods and response codes are used whenever possible.

The url for the requests is: \`https://api.auvo.com.br/v2\`

\## Media Types
This API use JSON format to represent resources. When sending content on \`PUT\`/\`PATCH\`/\`POST\` requests, you \*\*must\*\* specify the follow header:

 Content-Type: application/json

\## Response Codes
The common \[HTTP Response Status Codes\](https://github.com/for-GET/know-your-http-well/blob/master/status-codes.md) are used.

You will often see:

\\* 200 (OK) - GET and PATCH methods
\\* 201 (Created) - POST methods
\\* 204 (No content) - DELETE methods.

\## Error States

When something goes wrong, the response status code can be \`4xx\` if the error is related to your request structure or \`5xx\` if it's our server's fault.

Example:

\\* 400 (Bad request) - Check your request.
\\* 403 (Forbidden) - Rate limit temporarily exceeded.
\\* 404 (Not found) - The requested resource could not be found.
\\* 415 (Unsupported media type) - POST /tasks, when the Content-Type header is not defined
\\* 500 (Internal server error) - When a request throws an unexpected error. If you see this status code, please contact us: help@auvo.com.br

\## Authentication

Before having access to the API, the user \*\*must\*\* request the authorization token by making a POST to /login, containing the \`API key\` and \`API Token\` within the body, or a GET
containing the \`API key\` and \`API Token\` within the query parameter.
The authorization token lasts 30 minutes and must be renewed by making a new login request. Every request must have the authorization token in the header with the key \`Authorization\` followed by the valeu Bearer + \` authorization token\`.
\`API key\` and \`API Token\` can be found by accesing \[Menu > Integração\](https://app.auvo.com.br/integracao) in your Auvo's account

\## Rate-limiting

The API has rate limits to ensure stable performance. A single IP address can make up to \`400\` requests per minute (60 seconds). Exceeding this limit may result in temporary restrictions or throttling.

If the limit is reached, the user will receive an HTTP \`status code 403\` with the following message in the response body:

{ "error": "Rate limit temporarily exceeded" }.

This indicates that too many requests were made in a short period, and the user should wait before retrying.

\# Group Login

\## Login \[/login/?apiKey={apiKey}&apiToken={apiToken}\]

\+ Parameters

 \+ apiKey (string) ... \`apiKey\` of the user admin
 \+ apiToken (string) ... \`apiToken\` of the user admin

\+ Model

 \+ Body

 "result":{
 "authenticated": true,
 "created": "2019-05-08 16:15:59",
 "expiration": "2019-05-08 16:45:59",
 "accessToken": "abcdefciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1bmlxdWVfbmFtZSI6WyJkYW5pbG9AYXV2by5jb20iLCJkYW5pbG9AYXV2by5jb20iXSwianRpIjoiY2FmZDE4NGJiMzVlNGNiODg5ODMzMjI2NzdiMzgyNDMiLCJhcGlLZXkiOiJ3SkZFbm02NjFVanNXQ2hzS2htUlRhbEtBZnZodjNxTyIsImFwaVRva2VuIjoid0pGRW5tNjYxVWowcHdESmlCNERUWnp0a0I5dVkwSXciLCJuYmYiOjE1NTczNDI5NTksImV4cCI6MTU1NzM0NDc1OSwiaWF0IjoxNTU3MzQyOTU5LCJpc3MiOiJBdXZvX0FwaV9QdWJsaWNhIiwiYXVkIjoiVXN1YXJpb19BcGkifQ.kJPkhx2Jo15ZPSUU1Bbm019s2lZAJr-x6zAw3nJoVdHkyjgTkT2E9aPCYh1eVtJi6Ua\_zi8cIjvczSQ2twVHaAxEAnPgX7\_UySS350DB6rnusHUx5SA1KpWa0omISlygcyuP5mU-1YHQRvnr7uSAk3kiMXd6KMFNlFq23\_bRI1I01Lgb24c-o5W\_AW3qXlYmOnVFLYkh1tWaRjvWiBaX7dquB4X6D6LoC-AkNgtWr44CrBXGc2LaQHW10cf3XQ\_E448CdGA8QyefP57cA-s0Op80JWo3UlIxHyE5UkMng6shGYgSkp5jwEJ3cIZ4shlBBYyOYCscuZjMqlA1k6wOuQ",
 "message": "OK"
 }

\### Retrieve a authentication - GET \[GET/login/?apiKey={apiKey}&apiToken={apiToken}\]
The query param example describes the minimum required attributes to successfully retrieve a authentication.
The property \`authenticated\` will indicate whether the authentication was a success or not.

\+ Request (application/json)

\+ Response 200 (application/json)

 \[Login\]\[\]

\+ Response 400 (application/json)

 When making a request with invalid options, status code 400 will be returned. For example, not passing the \`apiKey\` parameter.

 \+ Body

 {
 "apiKey": \[\
 "The value '\\"\\"' is not valid."\
 \]
 }

\+ Response 404 (application/json)

 When the resource with the specified apiKey does not exist.

 \+ Body

\### Retrieve a authentication - POST \[POST /login/\]

The body example describes the minimum required attributes to successfully retrieve a authentication.
The property \`authenticated\` will indicate whether the authentication was a success or not.
See the \*\*Atributes\*\* or \*\*Json Schema\*\* in the Example section for all allowed attributes.

\+ Attributes
 \+ apiKey (required, string) - The user admin apiKey
 \+ apiToken (required, string) - The user admin apiToken


\+ Request (application/json)

 \+ Body

 {
 "apiKey": "as576a5da67s5da7s6d5d56a7",
 "apiToken": "h89g8fg9h8fg9h8fg9h8f9"
 }

 \+ Schema

 {
 "apiKey": string,
 "apiToken": string
 }

\+ Response 200 (application/json)

 \+ Body

 "result": {
 "authenticated": true,
 "created": "2019-05-08 16:15:59",
 "expiration": "2019-05-08 16:45:59",
 "accessToken": "abcDefGOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1bmlxdWVfbmFtZSI6WyJkYW5pbG9AYXV2by5jb20iLCJkYW5pbG9AYXV2by5jb20iXSwianRpIjoiY2FmZDE4NGJiMzVlNGNiODg5ODMzMjI2NzdiMzgyNDMiLCJhcGlLZXkiOiJ3SkZFbm02NjFVanNXQ2hzS2htUlRhbEtBZnZodjNxTyIsImFwaVRva2VuIjoid0pGRW5tNjYxVWowcHdESmlCNERUWnp0a0I5dVkwSXciLCJuYmYiOjE1NTczNDI5NTksImV4cCI6MTU1NzM0NDc1OSwiaWF0IjoxNTU3MzQyOTU5LCJpc3MiOiJBdXZvX0FwaV9QdWJsaWNhIiwiYXVkIjoiVXN1YXJpb19BcGkifQ.kJPkhx2Jo15ZPSUU1Bbm019s2lZAJr-x6zAw3nJoVdHkyjgTkT2E9aPCYh1eVtJi6Ua\_zi8cIjvczSQ2twVHaAxEAnPgX7\_UySS350DB6rnusHUx5SA1KpWa0omISlygcyuP5mU-1YHQRvnr7uSAk3kiMXd6KMFNlFq23\_bRI1I01Lgb24c-o5W\_AW3qXlYmOnVFLYkh1tWaRjvWiBaX7dquB4X6D6LoC-AkNgtWr44CrBXGc2LaQHW10cf3XQ\_E448CdGA8QyefP57cA-s0Op80JWo3UlIxHyE5UkMng6shGYgSkp5jwEJ3cIZ4shlBBYyOYCscuZjMqlA1k6wOuQ",
 "message": "OK"
 }

\# Group Users

\## User \[/users/{id}\]

\+ Parameters

 \+ id (number) ... \`id\` attribute of the \`User\`.

\+ Model

 \+ Body

 "result":{
 "userId": 123,
 "externalId": "123",
 "name": "Jason",
 "smartphoneNumber": "555555555555",
 "login": "login.auvo",
 "email": "login.auvo@email.com",
 "culture": "pt-BR",
 "jobPosition": "Administrador",
 "userType": { "userTypeId": 1, "description": "user" },
 "workDaysOfWeek": \[\
 1,\
 2,\
 3,\
 4,\
 5,\
 6,\
 7\
 \],
 "startWorkHour": "08:00:00",
 "endWorkHour": "18:00:00",
 "startLunchHour": "12:00:00",
 "endLunchHour": "14:00:00",
 "hourValue": 0,
 "pictureUrl": "",
 "BasePoint": {
 "address": "Rua C-137",
 "latitude": -16.711903488917,
 "longitude": -49.2775752032046
 },
 "openTaskInPlace": true,
 "grabGalleryPhotos": true,
 "gpsFrequency": 300,
 "checkInManual": true,
 "unavailableForTasks": true,
 "editTaskAfterCheckout": true,
 "informStartTravel": true,
 "changeBasePoint": true,
 "monitoringNotification": {
 "gpsActivation": 1,
 "gpsDisabling": 2,
 "appLogin": 3,
 "appLogin": 1
 },
 "employeeNotification": {
 "basePointChange": 1
 },
 "clientNotification": {
 "adressChange": 1
 },
 "taskNotification": {
 "checkIn": 1,
 "checkOut": 2,
 "rescheduling": 3,
 "travelStart": 1,
 "researchAnswer": 3,
 "delay": 3,
 "taskDelete": 3
 }
 }

\### Retrieve a User \[GET/users/{id}\]
\+ Request (application/json)

 \+ Headers

 Authorization: Bearer token

\+ Response 200 (application/json)

 \[User\]\[\]

\+ Response 400 (application/json)

 When making a request with invalid options, status code 400 will be returned. For example, not passing the \`id\` parameter.

 \+ Body

 {
 "id": \[\
 "The value '\\"\\"' is not valid."\
 \]
 }

\+ Response 404 (application/json)

 When the resource with the specified id does not exist.

 \+ Body

\### Add a new User \[POST /users/\]

The body example describes the minimum required attributes to successfully add an user. See the \*\*Atributes\*\* or \*\*Json Schema\*\* in the Example section for all allowed attributes.

\+ Attributes
 \+ externalId (string) - The user external id
 \+ name (required, string) - name of the user
 \+ smartPhoneNumber (required, string) - user phone number. Only numbers
 \+ culture (required, string) - culture name. For example \`pt-BR\`
 \+ jobPosition (required, string) - job position of the user
 \+ userType (required, number) - 1 - user \| 2 - team manager \| 3 - administrator
 \+ password (required, string) - password of the user
 \+ workDaysOfWeek (array\[number\]) - 1 - Sunday \| 2 -Monday \| 3 - Tuesday \| 4 - Wednesday \| 5 - Thuersday \| 6 - Friday \| 7 - Sunday
 \+ endLunchHour (string) - "HH:mm:ss" 24 hours format
 \+ endWorkHour (string) - "HH:mm:ss" 24 hours format
 \+ startLunchHour (string) - "HH:mm:ss" 24 hours format
 \+ startWorkHour (string) - "HH:mm:ss" 24 hours format
 \+ checkInManual (boolean) - If checkin is manual.
 \+ address (string) - base point address
 \+ latitude (number) - base point latitude
 \+ longitude (number) - base point longitude
 \+ openTaskInPlace (boolean) - open in-place task by application
 \\* grabGalleryPhotos (boolean) - allows you to take gallery photo in the app
 \+ gpsFrequency (number) - 60 - 1 minute\| 120 - 2 minutes \|180 - 3 minutes \| 240 - 4 minutes \| 300 - 5 minutes
 \+ login (required, string) - Login in the aplication
 \+ email (required, string) - User email
 \+ unavailableForTasks (boolean) - If user is available for tasks
 \+ editTaskAfterCheckout (boolean) - If can edit task after checkout
 \+ informStartTravel (boolean) - If user utilize start travel.
 \+ ChangeBasePoint (boolean) - If user can change change base point.
 \+ hourValue (number) - Monetary value of the worked hour
 \+ monitoringNotification (object)
 \*1:Email, 2:Push, 3:Both\*
 \+ gpsActivation(number)
 \+ gpsDisabling(number)
 \+ appLogin(number)
 \+ appLogout(number)
 \+ employeeNotification (object)
 \*1:Email, 2:Push, 3:Both\*
 \+ basePointChange(number)
 \+ clientNotification (object)
 \*1:Email, 2:Push, 3:Both\*
 \+ adressChange(number)
 \+ taskNotification (object)
 \*1:Email, 2:Push, 3:Both\*
 \+ checkIn(number)
 \+ checkout(number)
 \+ rescheduling(number)
 \+ travelStart(number)
 \+ researchAnswer(number)
 \+ delay(number)
 \+ taskDelete(number)

\+ Request (application/json)

 \+ Headers

 Authorization: Bearer token

 \+ Body

 {
 "externalId": "123",
 "name": "john",
 "smartPhoneNumber": "578123456789",
 "culture": "pt-BR",
 "jobPosition": "manager",
 "userType": ',
 "password": "123mudar",
 "workDaysOfWeek": \[1,2,3\],
 "startWorkHour": "08:00:00",
 "endWorkHour": "18:00:00",
 "startLunchHour": "13:00:00",
 "endLunchHour": "14:00:00",
 "hourValue": 10.0,
 "checkInManual": false,
 "address": "secret adress",
 "latitude": 900.0,
 "longitude": 900.0,
 "openTaskInPlace": false,
 "galleryPhotos": false,
 "gpsFrequency": 300,
 "login": "john.wick",
 "email": "johnwick@email.com",
 "unavailableForTasks": false,
 "editTaskAfterCheckout": false,
 "informStartTravel": false,
 "changeBasePoint": false,
 "paramMonitoringNotification":{
 "gpsActivation": 1,
 "gpsDisabling": 2,
 "appLogin": 3,
 "appLogout": 0
 },
 "ParamEmployeeNotification":{
 "basePointChange": 0
 },
 "ParamClientNotification":{
 "adressChange": 0
 },
 "ParamTaskNotification":{
 "checkIn": 1,
 "checkout": 2,
 "rescheduling": 3,
 "travelStart": 0,
 "researchAnswer": 1,
 "delay": 2,
 "taskDelete": 3
 }
 }

 \+ Schema

 {
 "externalId": string,
 "name": string,
 "smartPhoneNumber": string,
 "culture": string,
 "jobPosition": string,
 "userType": integer,
 "password": string,
 "workDaysOfWeek": \[1, 2, 3, 4, 5, 6, 7\],
 "startWorkHour": "HH:mm:ss",
 "endWorkHour": "HH:mm:ss",
 "startLunchHour": "HH:mm:ss",
 "endLunchHour": "HH:mm:ss",
 "hourValue": integer,
 "checkInManual": boolean,
 "address": string,
 "latitude": integer,
 "longitude": integer,
 "openTaskInPlace": boolean,
 "galleryPhotos": boolean,
 "gpsFrequency": integer,
 "login": string,
 "email": string,
 "unavailableForTasks": boolean,
 "editTaskAfterCheckout": boolean,
 "informStartTravel": boolean,
 "changeBasePoint": boolean,
 "paramMonitoringNotification":{
 "gpsActivation": integer,
 "gpsDisabling": integer,
 "appLogin": integer,
 "appLogout": integer
 },
 "paramEmployeeNotification":{
 "basePointChange": integer
 },
 "paramClientNotification":{
 "adressChange": integer
 },
 "paramTaskNotification":{
 "checkIn": integer,
 "checkout": ,
 "rescheduling": integer,
 "travelStart": integer,
 "researchAnswer": integer,
 "delay": integer,
 "taskDelete": integer
 }
 }

\+ Response 201 (application/json)

 \+ Body

 "result": {
 "userId": 123,
 "externalId": "1233",
 "name": "auvuro SA",
 "smartPhoneNumber": "123456789",
 "login": "email@email.com",
 "email": "email@email.com.br",
 "culture": "pt-BR",
 "jobPosition": "Dev",
 "userType": {
 "userTypeId": 4,
 "description": ""
 },
 "workDaysOfWeek": \[\
 2,\
 3,\
 4,\
 5,\
 6\
 \],
 "startWorkHour": "09:00:00",
 "endWorkHour": "17:00:00",
 "startLunchHour": "12:00:00",
 "endLunchHour": "13:00:00",
 "hourValue": 0,
 "pictureUrl": "",
 "basePoint": {
 "address": "Rua Goias, Cidade, Goiânia - GO, 74413-000, Brasil",
 "latitude": -16.68726699428,
 "longitude": -49.2998164147
 },
 "openTaskInPlace": true,
 "grabGalleryPhotos": true,
 "gpsFrequency": 60,
 "checkInManual": false,
 "unavailableForTasks": false,
 "editTaskAfterCheckout": true,
 "informStartTravel": true,
 "changeBasePoint": true,
 "monitoringNotification": {
 "gpsActivation": 0,
 "gpsDisabling": 0,
 "appLogin": 0,
 "appLogout": 0
 },
 "employeeNotification": {
 "basePointChange": 0
 },
 "clientNotification": {
 "adressChange": 0
 },
 "taskNotification": {
 "checkIn": 0,
 "checkout": 0,
 "rescheduling": 0,
 "travelStart": 0,
 "researchAnswer": 0,
 "delay": 3,
 "taskDelete": 0
 }
 }

\### Upsert - Add a new User or update an existing one \[PUT /users/\]
The body example describes the minimum required attributes to successfully add/update an user. See the \*\*Atributes\*\* or \*\*Json Schema\*\* in the Example section for all allowed attributes. Update or register a new user
according to one of its identifier, \`id\` OR \`externalId\`. If there is no user with the provided identifier, create a new user, if it exists, update it. Returns HTTP status code 200 if the user was updated and 201 if it was created.

\+ Attributes
 \+ externalId (string) - The user external id
 \+ name (required, string) - name of the user
 \+ smartPhoneNumber (required, string) - user phone number. Only numbers
 \+ culture (required, string) - culture name. For example \`pt-BR\`
 \+ jobPosition (required, string) - job position of the user
 \+ userType (required, number) - 1 - user \| 2 - team manager \| 3 - administrator
 \+ password (required, string) - password of the user
 \+ workDaysOfWeek (array\[number\]) - 1 - Sunday \| 2 -Monday \| 3 - Tuesday \| 4 - Wednesday \| 5 - Thuersday \| 6 - Friday \| 7 - Sunday
 \+ endLunchHour (string) - "HH:mm:ss" 24 hours format
 \+ endWorkHour (string) - "HH:mm:ss" 24 hours format
 \+ startLunchHour (string) - "HH:mm:ss" 24 hours format
 \+ startWorkHour (string) - "HH:mm:ss" 24 hours format
 \+ checkInManual (boolean) - If checkin is manual.
 \+ address (string) - base point address
 \+ latitude (number) - base point latitude
 \+ longitude (number) - base point longitude
 \+ openTaskInPlace (boolean) - open in-place task by application
 \\* grabGalleryPhotos (boolean) - allows you to take gallery photo in the app
 \+ gpsFrequency (number) - 60 - 1 minute\| 120 - 2 minutes \|180 - 3 minutes \| 240 - 4 minutes \| 300 - 5 minutes
 \+ login (required, string) - Login in the aplication
 \+ email (required, string) - User email
 \+ unavailableForTasks (boolean) - If user is available for tasks
 \+ editTaskAfterCheckout (boolean) - If can edit task after checkout
 \+ informStartTravel (boolean) - If user utilize start travel.
 \+ ChangeBasePoint (boolean) - If user can change change base point.
 \+ hourValue (number) - Monetary value of the worked hour
 \+ monitoringNotification (object)
 \*1:Email, 2:Push, 3:Both\*
 \+ gpsActivation(number)
 \+ gpsDisabling(number)
 \+ appLogin(number)
 \+ appLogout(number)
 \+ employeeNotification (object)
 \*1:Email, 2:Push, 3:Both\*
 \+ basePointChange(number)
 \+ clientNotification (object)
 \*1:Email, 2:Push, 3:Both\*
 \+ adressChange(number)
 \+ taskNotification (object)
 \*1:Email, 2:Push, 3:Both\*
 \+ checkIn(number)
 \+ checkout(number)
 \+ rescheduling(number)
 \+ travelStart(number)
 \+ researchAnswer(number)
 \+ delay(number)
 \+ taskDelete(number)

\+ Request (application/json)

 \+ Headers

 Authorization: Bearer token

 \+ Body

 {
 "externalId": "123",
 "name": "john",
 "smartPhoneNumber": "578123456789",
 "culture": "pt-BR",
 "jobPosition": "manager",
 "userType": ',
 "password": "123mudar",
 "workDaysOfWeek": \[1,2,3\],
 "startWorkHour": "08:00:00",
 "endWorkHour": "18:00:00",
 "startLunchHour": "13:00:00",
 "endLunchHour": "14:00:00",
 "hourValue": 10.0,
 "checkInManual": false,
 "address": "secret adress",
 "latitude": 900.0,
 "longitude": 900.0,
 "openTaskInPlace": false,
 "galleryPhotos": false,
 "gpsFrequency": 300,
 "login": "john.wick",
 "email": "johnwick@email.com",
 "unavailableForTasks": false,
 "editTaskAfterCheckout": false,
 "informStartTravel": false,
 "changeBasePoint": false,
 "paramMonitoringNotification":{
 "gpsActivation": 1,
 "gpsDisabling": 2,
 "appLogin": 3,
 "appLogout": 0
 },
 "ParamEmployeeNotification":{
 "basePointChange": 0
 },
 "ParamClientNotification":{
 "adressChange": 0
 },
 "ParamTaskNotification":{
 "checkIn": 1,
 "checkout": 2,
 "rescheduling": 3,
 "travelStart": 0,
 "researchAnswer": 1,
 "delay": 2,
 "taskDelete": 3
 }
 }

 \+ Schema

 {
 "externalId": string,
 "name": string,
 "smartPhoneNumber": string,
 "culture": string,
 "jobPosition": string,
 "userType": integer,
 "password": string,
 "workDaysOfWeek": \[1, 2, 3, 4, 5, 6, 7\],
 "startWorkHour": "HH:mm:ss",
 "endWorkHour": "HH:mm:ss",
 "startLunchHour": "HH:mm:ss",
 "endLunchHour": "HH:mm:ss",
 "hourValue": integer,
 "checkInManual": boolean,
 "address": string,
 "latitude": integer,
 "longitude": integer,
 "openTaskInPlace": boolean,
 "galleryPhotos": boolean,
 "gpsFrequency": integer,
 "login": string,
 "email": string,
 "unavailableForTasks": boolean,
 "editTaskAfterCheckout": boolean,
 "informStartTravel": boolean,
 "changeBasePoint": boolean,
 "paramMonitoringNotification":{
 "gpsActivation": integer,
 "gpsDisabling": integer,
 "appLogin": integer,
 "appLogout": integer
 },
 "paramEmployeeNotification":{
 "basePointChange": integer
 },
 "paramClientNotification":{
 "adressChange": integer
 },
 "paramTaskNotification":{
 "checkIn": integer,
 "checkout": ,
 "rescheduling": integer,
 "travelStart": integer,
 "researchAnswer": integer,
 "delay": integer,
 "taskDelete": integer
 }
 }

\+ Response 201 (application/json)

 \+ Body

 "result": {
 "userId": 123,
 "externalId": "1233",
 "name": "auvuro SA",
 "smartPhoneNumber": "123456789",
 "login": "email@email.com",
 "email": "email@email.com.br",
 "culture": "pt-BR",
 "jobPosition": "Dev",
 "userType": {
 "userTypeId": 4,
 "description": ""
 },
 "workDaysOfWeek": \[\
 2,\
 3,\
 4,\
 5,\
 6\
 \],
 "startWorkHour": "09:00:00",
 "endWorkHour": "17:00:00",
 "startLunchHour": "12:00:00",
 "endLunchHour": "13:00:00",
 "hourValue": 0,
 "pictureUrl": "",
 "basePoint": {
 "address": "Rua Goias, Cidade, Goiânia - GO, 74413-000, Brasil",
 "latitude": -16.68726699428,
 "longitude": -49.2998164147
 },
 "openTaskInPlace": true,
 "grabGalleryPhotos": true,
 "gpsFrequency": 60,
 "checkInManual": false,
 "unavailableForTasks": false,
 "editTaskAfterCheckout": true,
 "informStartTravel": true,
 "changeBasePoint": true,
 "monitoringNotification": {
 "gpsActivation": 0,
 "gpsDisabling": 0,
 "appLogin": 0,
 "appLogout": 0
 },
 "employeeNotification": {
 "basePointChange": 0
 },
 "clientNotification": {
 "adressChange": 0
 },
 "taskNotification": {
 "checkIn": 0,
 "checkout": 0,
 "rescheduling": 0,
 "travelStart": 0,
 "researchAnswer": 0,
 "delay": 3,
 "taskDelete": 0
 }
 }

\### Edit a User \[PATCH /users/{id}\]
To update a \`User\`, send a JSONPatchDocument with updated value for one or more of the \`UserPatch\` attributes. See the \*\*Atributes\*\* or \*\*Json Schema\*\* in the Example section for all allowed attributes.
JsonPatch example: { "op": "replace", "path": "login", "value": "login.user" }
For more information on JsonPatch, visit: \`http://jsonpatch.com/\`.

\+ Attributes
 \+ login (string) - Login in the aplication
 \+ externalId (string) - The user external id
 \+ password (string) - password of the user
 \+ name (string) - name of the user
 \+ smartPhoneNumber (string) - user phone number. Only numbers. If multiple numbers, separate by comma
 \+ email (string) - User email. If multiple emails, separate by comma
 \+ jobPosition (string) - job position of the user
 \+ enterprise (string) - Enterprise of the user
 \+ culture (string) - culture name. For example \`pt-BR\`
 \+ hourValue (number) - Monetary value of the worked hour
 \+ userType (number) - 1 - user \| 2 - team manager \| 3 - administrator
 \+ checkInManual (boolean) - If checkin is manual.
 \+ checkOutManual (boolean) - If checkout is manual.
 \+ address (string) - base point address
 \+ latitude (number) - base point latitude
 \+ longitude (number) - base point longitude
 \+ gpsFrequency (number) - 60 - 1 minute\| 120 - 2 minutes \|180 - 3 minutes \| 240 - 4 minutes \| 300 - 5 minutes
 \+ openTaskInPlace (boolean) - open in-place task by application
 \+ GalleryPhotos (boolean) - allows you to take gallery photo in the app
 \+ unavailableForTasks (boolean) - If user is available for tasks
 \+ editTaskAfterCheckout (boolean) - If can edit task after checkout
 \+ informStartTravel (boolean) - If user utilize start travel.
 \+ changeBasePoint (boolean) - If user can change change base point.

\+ Request (application/json)

 \+ Headers

 Authorization: Bearer token

 \+ Body

 \[\
 { "op": "replace", "path": "login", "value": "login.user" }\
 \]

 \+ Schema

 {
 "login": string,
 "externalId": string,
 "password": string,
 "name": string,
 "smartPhoneNumber": string,
 "email": string,
 "jobPosition": nstringull,
 "enterprise": string,
 "culture": string,
 "hourValue": number,
 "userType": number,
 "checkInManual": boolean,
 "checkOutManual": boolean,
 "address": string,
 "latitude": number,
 "longitude": number,
 "gpsFrequency": number,
 "openTaskInPlace": boolean,
 "galleryPhotos": boolean,
 "unavailableForTasks": boolean,
 "editTaskAfterCheckout": boolean,
 "informStartTravel": boolean,
 "changeBasePoint": boolean
 }

\+ Response 200 (application/json)

 \+ Body

 "result": {
 "userId": 123,
 "externalId": "123",
 "name": "Teste Zapier",
 "smartPhoneNumber": \["12345678969"\],
 "login": "zapier.login",
 "email": \["zapier..email@email.com"\],
 "culture": "pt-BR",
 "jobPosition": "zap",
 "userType": {
 "userTypeId": 2,
 "description": "Team Manager"
 },
 "workDaysOfWeek": \[\],
 "startWorkHour": "",
 "endWorkHour": "",
 "startLunchHour": "",
 "endLunchHour": "",
 "hourValue": 0,
 "pictureUrl": "",
 "basePoint": {
 "address": "",
 "latitude": 123,
 "longitude": 456
 },
 "openTaskInPlace": true,
 "grabGalleryPhotos": true,
 "gpsFrequency": 300,
 "checkInManual": false,
 "unavailableForTasks": false,
 "editTaskAfterCheckout": true,
 "informStartTravel": false,
 "changeBasePoint": true,
 "monitoringNotification": {
 "gpsActivation": 0,
 "gpsDisabling": 0,
 "appLogin": 0,
 "appLogout": 0
 },
 "employeeNotification": {
 "basePointChange": 0
 },
 "clientNotification": {
 "adressChange": 0
 },
 "taskNotification": {
 "checkIn": 0,
 "checkout": 0,
 "rescheduling": 0,
 "travelStart": 0,
 "researchAnswer": 0,
 "delay": 0,
 "taskDelete": 0
 }
 }


\### Delete a User \[DELETE /users/{id}\]

\+ Request (application/json)

 \+ Headers

 Authorization: Bearer token

\+ Parameters

 \+ id (number) ... \`id\` of the user to delete.

\+ Response 204


\### Retrieve a list of Users \[GET/users/?paramFilter={paramFilter}&page={page}&pageSize={pageSize}&order={order}&selectfields={selectfields}\]

\+ Parameters
 \+ paramFilter (optional, string) ... Must be a json encoded string.
 \+ userId (number) - The user id
 \+ name (string) - name of the user
 \+ smartPhoneNumber (string) - user phone number. Only numbers
 \+ userType (string) - Usuario:1, Manager:2, Administrator:3
 \+ externalId (string) - User external ids. Allow multiples, separated by comma
 \+ page (required, int) ... Page of the selection. Default 1.
 \+ pageSize (required, int) ... Amount of records of the selection. Default 10.
 \+ order (required, string) ... "asc"/0 for Ascending or "desc"/1 for Descending. Default "asc".
 \+ selectfields (optional, string) ... For all fields, use empty string. To select fields, use the properties of the returned object separated by commas.

\+ Request (application/json)

 \+ Headers

 Authorization: Bearer token

\+ Response 200 (application/json)

 {
 "result": {
 "entityList": \[\
 {\
 "userId": 123,\
 "externalId": "123",\
 "name": "Jason",\
 "smartphoneNumber": "555555555555",\
 "login": "login.auvo",\
 "email": "login.auvo@email.com",\
 "culture": "pt-BR",\
 "jobPosition": "Administrador",\
 "userType": { "userTypeId": 1, "description": "user" },\
 "workDaysOfWeek": \[\
 1,\
 2,\
 3,\
 4,\
 5,\
 6,\
 7\
 \],\
 "startWorkHour": "08:00:00",\
 "endWorkHour": "18:00:00",\
 "startLunchHour": "12:00:00",\
 "endLunchHour": "14:00:00",\
 "hourValue": 0,\
 "pictureUrl": "",\
 "BasePoint": {\
 "address": "Rua C-137",\
 "latitude": -16.711903488917,\
 "longitude": -49.2775752032046\
 },\
 "openTaskInPlace": true,\
 "grabGalleryPhotos": true,\
 "gpsFrequency": 300,\
 "checkInManual": true,\
 "unavailableForTasks": true,\
 "editTaskAfterCheckout": true,\
 "informStartTravel": true,\
 "changeBasePoint": true,\
 "monitoringNotification": {\
 "gpsActivation": 1,\
 "gpsDisabling": 2,\
 "appLogin": 3,\
 "appLogin": 1\
 },\
 "employeeNotification": {\
 "basePointChange": 1\
 },\
 "clientNotification": {\
 "adressChange": 1\
 },\
 "taskNotification": {\
 "checkIn": 1,\
 "checkOut": 2,\
 "rescheduling": 3,\
 "travelStart": 1,\
 "researchAnswer": 3,\
 "delay": 3,\
 "taskDelete": 3\
 }\
 }\
 \],
 "pagedSearchReturnData": {
 "order": 0,
 "pageSize": 1,
 "page": 1,
 "totalItems": 2
 },
 "links": \[\
 {\
 "href": "https://api.auvo.com.br/v2/Users?ParamFilter=%7B%0D%0A%22name%22%3A%22a%22%0D%0A%7D&Page=1&PageSize=1&Order=Asc",\
 "rel": "self",\
 "method": "GET"\
 },\
 {\
 "href": "https://api.auvo.com.br/v2/Users?ParamFilter=%7B%0D%0A%22name%22%3A%22a%22%0D%0A%7D&Page=2&PageSize=1&Order=Asc",\
 "rel": "nextPage",\
 "method": "GET"\
 }\
 \]
 }
 }

\+ Response 400 (application/json)

 When making a request with invalid options, status code 400 will be returned. For example, not passing the \`paramFilter\` parameter ( https://api.auvo.com.br/v2/users/?page=1&pageSize=1&order=1&selectfields= ).

 \+ Body

 {
 "message": "The paramFilter is required as ParamUserFilter string json.",
 "target": null,
 "errorCode": 0,
 "errors": null
 }

\# Group Tasks

\## Task \[/tasks/{id}\]

\+ Parameters

 \+ id (number) ... \`taskID\` attribute of the \`Task\`.

\+ Model

 \+ Body

 "result":{
 "taskID": 23,
 "externalId": "123",
 "idUserFrom": 123,
 "idUserTo": 123,
 "userToName": "Colaborador sem ponto base",
 "userFromName": "Paulo",
 "customerId": 456,
 "customerExternalId": 10,
 "customerDescription": "Customer x",
 "taskType": 23,
 "taskTypeDescription": "Edição automatizada 897263119",
 "creationDate": "2016-03-23T14:10:35",
 "taskDate": "2016-03-23T18:00:00",
 "latitude": -16.6872086111083,
 "longitude": -49.2995542287827,
 "address": "avenue X",
 "orientation": "Go get a beer!",
 "priority": "1",
 "deliveredOnSmarthPhone": true,
 "deliveredDate": "2016-03-23T14:11:31",
 "finished": true,
 "report": "ok",
 "visualized": true,
 "visualizedDate": "2016-03-23T14:12:00",
 "checkIn": true,
 "checkInDate": "2016-03-23T18:05:00",
 "checkOut": true,
 "checkOutDate": "2016-03-23T18:10:00",
 "checkinType": "1",
 "equipmentsId": \[109638, 109753\],
 "keyWords": \[\
 "keyword id"\
 \],
 "keyWordsDescriptions": \[\
 "Descriptions of keywords"\
 \],
 "inputedKm": 10,
 "adoptedKm": 11,
 "attachments":\[\
 {\
 "id": "1",\
 "url": "",\
 "attachmentType": 1,\
 "subtitle": "",\
 "description": "",\
 "extension": ""\
 }\
 \],
 "questionnaires":\[\
 {\
 "itemId": "1",\
 "questionnaireId": "",\
 "questionnaireDescription": 1,\
 "answers": \[\
 {\
 "questionId": "1",\
 "questionDescription": "",\
 "replyId": 1,\
 "reply": 1,\
 "replyDate": "2016-03-23T18:10:00"\
 }\
 \]\
 }\
 \],
 "signatureUrl": "signature url",
 "checkInDistance": 0,
 "checkOutDistance": 0,
 "sendSatisfactionSurvey": true,
 "survey": "",
 "taskUrl": "",
 "pendency": "",
 "dateLastUpdate":"2016-03-23T18:10:00",
 "ticketId": 558,
 "ticketTitle": "Título do ticket",
 "signatureName": "Oliveira Silva",
 "signatureDocument": "00008500100",
 "expense": "2.500.000,00",
 "duration": "",
 "durationDecimal": "",
 "displacementStart": "",
 "products": \[{\
 "productId": "63867f52-b262-410a-a409-cc25ba92ded1",\
 "code": "456",\
 "name": null,\
 "description": null,\
 "quantity": 0.0,\
 "unitaryValue": 0.0,\
 "totalValue": 0.0,\
 "userResponsible": null,\
 "userResponsibleCode": 0,\
 "dateRegister": null,\
 "dateEdit": null\
 "discount": {\
 "value": 0.00,\
 "type": "Valor"\
 }\
 }\
 \],
 "services": \[{\
 "id": "00000000-0000-0000-0000-000000000000",\
 "name": null,\
 "quantity": 0.0,\
 "unitaryValue": 0.0,\
 "totalValue": 0.0,\
 "userResponsible": null,\
 "userResponsibleCode": 0,\
 "dateRegister": null,\
 "dateEdit": null\
 "discount": {\
 "value": 0.00,\
 "type": "Valor"\
 }\
 }\],
 "additionalCosts": \[{\
 "additionalCostId": "63867f52-b262-410a-a409-cc25ba92ded1",\
 "code": "456",\
 "name": null,\
 "unitaryValue": 0.0,\
 "userResponsible": null,\
 "userResponsibleCode": 0,\
 "dateRegister": null,\
 "dateEdit": null\
 }\],
 "summary": {
 "totalProducts": 0.0,
 "totalServices": 0.0,
 "totalAdditionalCosts": 0.0,
 "totalValue": 0.0,
 "discount": {
 "value": 0.00,
 "type": "Valor"
 }
 },
 "estimatedDuration": "00:00:00",
 "financialCategory": "",
 "taskStatus": "1"
 }

\### Retrieve a Task \[GET/tasks/{id}\]

The "taskStatus" task return attribute has the following return values:

\\* Opened = 1,
\\* InDisplacement = 2,
\\* CheckedIn = 3,
\\* CheckedOut = 4,
\\* Finished = 5,
\\* Paused = 6

\+ Request (application/json)

 \+ Headers

 Authorization: Bearer token

\+ Response 200 (application/json)

 \[Task\]\[\]

\+ Response 400 (application/json)

 When making a request with invalid options, status code 400 will be returned. For example, passing an invalid \`id\` parameter.

 \+ Body

 {
 "id": \[\
 "The value 'x' is not valid."\
 \]
 }

\+ Response 404

 When the resource with the specified id does not exist.


\### Add a new Task \[POST /tasks/\]

The body example describes the minimum required attributes to successfully add a task. See the \*\*Atributes\*\* or \*\*Json Schema\*\* in the Example section for all allowed attributes.

The task address will preferably be obtained through the client's address.
If the customer ID was not informed, the data will be captured by the parameters of the register itself.
When the latitude and longitude are not informed, the Auvo API will attempt to obtain this information
in the HERE API through the address you provided.

\+ Attributes
 \+ externalId (string) - External task id
 \+ taskType (number) - taskTypeId of the task type
 \+ idUserFrom (required, number) - userId of the User that is opening the task
 \+ idUserTo (number) - userId of the User responsable for executing the task
 \+ TeamId (number) - Existing team id at Auvo
 \+ taskDate (string) - Date and time for the execution of the task
 \+ latitude (required, number) - Latitude of the task
 \+ longitude (required, number) - Longitude of the task
 \+ address (required, string) - Address of the task
 \+ orientation (required, string) - Orientation of the task
 \+ priority (required, number) - Priority of the task. 1 - Low \| 2 - Medium \| 3 - High
 \+ questionnaireId (number) - QuestionnaireId of the CheckList(Questionnaire) included in the task
 \+ customerId (number) - CustomerId of the Customer chosen for the task
 \+ checkinType (number) - Checkin type of the task type. 1 - Manual \| 2 - Automatic \| 3 - User
 \+ attachments (array\[object\])
 \+ name(required, string) - the name MUST contain the file type (Ex. "my\_file.pdf")
 \+ file(required, string) - base 64 file.
 \+ keyWords (array\[string\]) - list of keywords id.
 \+ sendSatisfactionSurvey (boolean) - Send satisfaction survey for the task
 \+ equipmentsId (array\[number\]) - list of equipmentsId id.
 \+ taskProducts (array\[object\])
 \+ ProductId(required, string) - ProductId attribute of the Product.
 \+ DiscountType(string) - A discount type can be 0 - monetary value or 1 - percentage.
 \+ DiscountValue(string) - A value in decimal format according to the discount type specified.
 \+ Quantity(required, string) - The quantity of the product in decimal format.
 \+ Value(required, string) - The unit value of the product in decimal format.
 \+ taskServices (array\[object\])
 \+ ServiceId(required, string) - Id attribute of the Service.
 \+ DiscountType(string) - A discount type can be 0 - monetary value or 1 - percentage.
 \+ DiscountValue(string) - A value in decimal format according to the discount type specified.
 \+ Quantity(required, string) - The quantity of the service in decimal format.
 \+ Value(required, string) - The unitary value of the service in decimal format.
 \+ taskAdditionalCosts (array\[object\])
 \+ AdditionalCostId(required, string) - AdditionalCostId attribute of the Additional cost.
 \+ Value(required, string) - The unitary value of the product in decimal format.
 \+ taskDiscount (object)
 \+ type(required, number) - A discount type can be 0 - monetary value or 1 - percentage.
 \+ value(required, string) - A value in decimal format according to the discount type specified.
 \+ financialCategory (string) - Name of the Financial Category.

\+ Request (application/json)
 \+ Headers

 Authorization: Bearer token

 \+ Body

 {
 "externalId": "123",
 "taskType": 1,
 "idUserFrom": 99,
 "idUserTo": 69,
 "teamId": 6,
 "taskDate": "2016-04-23T18:00:00",
 "latitude": -16.6872086111083,
 "longitude": -49.2995542287827,
 "address": "avenue Y",
 "orientation": "Gotta Catch 'Em All",
 "priority": 1,
 "questionnaireId": 3,
 "customerId": 1,
 "checkinType": 1,
 "sendSatisfactionSurvey": false,
 "attachments": \[\
 {\
 "name": "my\_file.pdf",\
 "file": "base64 encoded file"\
 }\
 \],
 "keyWords": \[\
 1\
 \],
 "financialCategory": "Category Name"
 }

 \+ Schema

 {
 "externalId": string,
 "taskType": integer,
 "idUserFrom": integer,
 "idUserTo": integer,
 "teamId": integer,
 "taskDate": "yyyy-MM-ddTHH:mm:ss",
 "latitude": integer,
 "longitude": integer,
 "address": string,
 "orientation": string,
 "priority": integer,
 "questionnaireId": integer,
 "customerId": integer
 "checkinType": integer,
 "sendSatisfactionSurvey": boolean,
 "attachments": array,
 "keyWords": array,
 "financialCategory": string
 }

\+ Response 201 (application/json)

 \+ Body

 "result": {
 "taskID": 123,
 "externalId": "3",
 "idUserFrom": 120,
 "idUserTo": 120,
 "customerId": 0,
 "customerExternalId": 10,
 "customerDescription": "Customer x",
 "taskType": 0,
 "creationDate": "2019-04-03T13:06:09",
 "taskDate": "2019-03-26T14:00:00",
 "latitude": 96,
 "longitude": 96,
 "address": "rua rua 123",
 "orientation": "orientation",
 "priority": 1,
 "deliveredOnSmarthPhone": false,
 "deliveredDate": "0001-01-01T00:00:00",
 "finished": false,
 "report": "",
 "visualized": false,
 "visualizedDate": "",
 "checkIn": false,
 "checkInDate": "",
 "checkOut": false,
 "checkOutDate": "",
 "checkinType": 1,
 "keyWords": \[\],
 "inputedKm": 0,
 "adoptedKm": 0,
 "attachments": \[\],
 "questionnaires": \[\],
 "signatureUrl": "",
 "checkInDistance": 0,
 "checkOutDistance": 0,
 "survey": "https://app.auvo.com.br/pesquisasatisfacao/formulario/054599ce-247b-4b34-8dbd-19d47d97de123",
 "taskUrl": "https://app.auvo.com.br/informacoes/tarefa/054599ce-247b-4b34-8dbd-19d47d97d123",
 "pendency": "",
 "dateLastUpdate": "2019-04-03T13:06:09",
 "ticketId": 558,
 "ticketTitle": "Título do ticket",
 "signatureName": "Oliveira Silva",
 "signatureDocument": "00008500100",
 "expense": "2.500.000,00",
 "products": \[{\
 "productId": "63867f52-b262-410a-a409-cc25ba92ded1",\
 "code": "456",\
 "name": null,\
 "description": null,\
 "quantity": 0.0,\
 "unitaryValue": 0.0,\
 "totalValue": 0.0,\
 "userResponsible": null,\
 "userResponsibleCode": 0,\
 "dateRegister": null,\
 "dateEdit": null\
 "discount": {\
 "value": 0.00,\
 "type": "Valor"\
 }\
 }\
 \],
 "services": \[{\
 "id": "00000000-0000-0000-0000-000000000000",\
 "name": null,\
 "quantity": 0.0,\
 "unitaryValue": 0.0,\
 "totalValue": 0.0,\
 "userResponsible": null,\
 "userResponsibleCode": 0,\
 "dateRegister": null,\
 "dateEdit": null\
 "discount": {\
 "value": 0.00,\
 "type": "Valor"\
 }\
 }\],
 "additionalCosts": \[{\
 "additionalCostId": "63867f52-b262-410a-a409-cc25ba92ded1",\
 "code": "456",\
 "name": null,\
 "unitaryValue": 0.0,\
 "userResponsible": null,\
 "userResponsibleCode": 0,\
 "dateRegister": null,\
 "dateEdit": null\
 }\],
 "summary": {
 "totalProducts": 0.0,
 "totalServices": 0.0,
 "totalAdditionalCosts": 0.0,
 "totalValue": 0.0,
 "discount": {
 "value": 0.00,
 "type": "Valor"
 }
 },
 "taskStatus": 1,
 "financialCategory": "Category Name"
 }

\### Upsert - Add a new Task or update an existing one \[PUT /tasks/\]

The body example describes the minimum required attributes to successfully add/update a task. See the \*\*Atributes\*\* or \*\*Json Schema\*\* in the Example section for all allowed attributes. Update or register a new task
according to its identifier \`id\` . If there is no task with the provided identifier, create a new task, if it exists, update it. Returns HTTP status code 200 if the task was updated and 201
if it was created.

\+ Attributes
 \+ id (number) - identifier of a registered task
 \+ externalId (string) - External task identifier
 \+ taskType (number) - taskTypeId of the task type
 \+ idUserFrom (required, number) - userId of the User that is opening the task
 \+ idUserTo (number) - userId of the User responsable for executing the task
 \+ TeamId (number) - Existing team id at Auvo
 \+ taskDate (string) - Date and time for the execution of the task
 \+ latitude (required, number) - Latitude of the task
 \+ longitude (required, number) - Longitude of the task
 \+ address (required, string) - Address of the task
 \+ orientation (required, string) - Orientation of the task
 \+ priority (required, number) - Priority of the task. 1 - Low \| 2 - Medium \| 3 - High
 \+ questionnaireId (number) - QuestionnaireId of the CheckList(Questionnaire) included in the task
 \+ customerId (number) - CustomerId of the Customer chosen for the task
 \+ checkinType (number) - Checkin type of the task type. 1 - Manual \| 2 - Automatic \| 3 - User
 \+ attachments (array\[object\])
 \+ name(required, string) - the name MUST contain the file type (Ex. "my\_file.pdf")
 \+ file(required, string) - base 64 file.
 \+ keyWords (array\[string\]) - list of keywords id.
 \+ sendSatisfactionSurvey (boolean) - Send satisfaction survey for the task
 \+ taskProducts (array\[object\])
 \+ ProductId(required, string) - ProductId attribute of the product.
 \+ DiscountType(string) - A discount type can be 0 - monetary value or 1 - percentage.
 \+ DiscountValue(string) - A value in decimal format according to the discount type specified.
 \+ Quantity(required, string) - The quantity of the product in decimal format.
 \+ Value(required, string) - The unit value of the product in decimal format.
 \+ taskServices (array\[object\])
 \+ ServiceId(required, string) - Id attribute of the service.
 \+ DiscountType(string) - A discount type can be 0 - monetary value or 1 - percentage.
 \+ DiscountValue(string) - A value in decimal format according to the discount type specified.
 \+ Quantity(required, string) - The quantity of the service in decimal format.
 \+ Value(required, string) - The unitary value of the service in decimal format.
 \+ taskAdditionalCosts (array\[object\])
 \+ AdditionalCostId(required, string) - AdditionalCostId attribute of the additional cost.
 \+ Value(required, string) - The unitary value of the product in decimal format.
 \+ taskDiscount (object)
 \+ type(required, number) - A discount type can be 0 - monetary value or 1 - percentage.
 \+ value(required, string) - A value in decimal format according to the discount type specified.
 \+ financialCategory (string) - Name of the Financial Category.

\+ Request (application/json)
 \+ Headers

 Authorization: Bearer token

 \+ Body

 {
 "externalId": "123",
 "taskType": 1,
 "idUserFrom": 99,
 "idUserTo": 69,
 "teamId": 6,
 "taskDate": "2016-04-23T18:00:00",
 "latitude": -16.6872086111083,
 "longitude": -49.2995542287827,
 "address": "avenue Y",
 "orientation": "Gotta Catch 'Em All",
 "priority": 1,
 "questionnaireId": 3,
 "customerId": 1,
 "checkinType": 1,
 "sendSatisfactionSurvey": false,
 "attachments": \[\
 {\
 "name": "my\_file.pdf",\
 "file": "base64 encoded file"\
 }\
 \],
 "keyWords": \[\
 1\
 \],
 "financialCategory": "Category Name"
 }

 \+ Schema

 {
 "externalId": string,
 "taskType": integer,
 "idUserFrom": integer,
 "idUserTo": integer,
 "teamId": integer,
 "taskDate": "yyyy-MM-ddTHH:mm:ss",
 "latitude": integer,
 "longitude": integer,
 "address": string,
 "orientation": string,
 "priority": integer,
 "questionnaireId": integer,
 "customerId": integer
 "checkinType": integer,
 "sendSatisfactionSurvey": boolean,
 "attachments": array,
 "keyWords": array,
 "financialCategory": string
 }

\+ Response 201 (application/json)

 \+ Body

 "result": {
 "taskID": 123,
 "externalId": "3",
 "idUserFrom": 120,
 "idUserTo": 120,
 "customerId": 0,
 "customerExternalId": 10,
 "customerDescription": "Customer x",
 "taskType": 0,
 "creationDate": "2019-04-03T13:06:09",
 "taskDate": "2019-03-26T14:00:00",
 "latitude": 96,
 "longitude": 96,
 "address": "rua rua 123",
 "orientation": "orientation",
 "priority": 1,
 "deliveredOnSmarthPhone": false,
 "deliveredDate": "0001-01-01T00:00:00",
 "finished": false,
 "report": "",
 "visualized": false,
 "visualizedDate": "",
 "checkIn": false,
 "checkInDate": "",
 "checkOut": false,
 "checkOutDate": "",
 "checkinType": 1,
 "keyWords": \[\],
 "inputedKm": 0,
 "adoptedKm": 0,
 "attachments": \[\],
 "questionnaires": \[\],
 "signatureUrl": "",
 "checkInDistance": 0,
 "checkOutDistance": 0,
 "survey": "https://app.auvo.com.br/pesquisasatisfacao/formulario/054599ce-247b-4b34-8dbd-19d47d97de123",
 "taskUrl": "https://app.auvo.com.br/informacoes/tarefa/054599ce-247b-4b34-8dbd-19d47d97d123",
 "pendency": "",
 "dateLastUpdate": "2019-04-03T13:06:09",
 "ticketId": 558,
 "ticketTitle": "Título do ticket",
 "signatureName": "Oliveira Silva",
 "signatureDocument": "00008500100",
 "expense": "2.500.000,00",
 "products": \[{\
 "productId": "63867f52-b262-410a-a409-cc25ba92ded1",\
 "externalId": "123",\
 "code": "456",\
 "name": null,\
 "description": null,\
 "quantity": 0.0,\
 "unitaryValue": 0.0,\
 "totalValue": 0.0,\
 "userResponsible": null,\
 "userResponsibleCode": 0,\
 "dateRegister": null,\
 "dateEdit": null\
 "discount": {\
 "value": 0.00,\
 "type": "Valor"\
 }\
 }\
 \],
 "services": \[{\
 "id": "00000000-0000-0000-0000-000000000000",\
 "name": null,\
 "quantity": 0.0,\
 "unitaryValue": 0.0,\
 "totalValue": 0.0,\
 "userResponsible": null,\
 "userResponsibleCode": 0,\
 "dateRegister": null,\
 "dateEdit": null\
 "discount": {\
 "value": 0.00,\
 "type": "Valor"\
 }\
 }\],
 "additionalCosts": \[{\
 "additionalCostId": "63867f52-b262-410a-a409-cc25ba92ded1",\
 "code": "456",\
 "name": null,\
 "unitaryValue": 0.0,\
 "userResponsible": null,\
 "userResponsibleCode": 0,\
 "dateRegister": null,\
 "dateEdit": null\
 }\],
 "summary": {
 "totalProducts": 0.0,
 "totalServices": 0.0,
 "totalAdditionalCosts": 0.0,
 "totalValue": 0.0,
 "discount": {
 "value": 0.00,
 "type": "Valor"
 }
 },
 "taskStatus": 1,
 "financialCategory": "Category Name"
 }

\### Edit a Task \[PATCH /tasks/{id}\]
To update a \`Task\`, send a JSONPatchDocument with updated value for one or more of the \`TaskPatch\` attributes. See the \*\*Atributes\*\* or \*\*Json Schema\*\* in the Example section for all allowed attributes.
JsonPatch example: { "op": "replace", "path": "orientation", "value": "orientation value" }
For more information on JsonPatch, visit: \`http://jsonpatch.com/\`.

\+ Attributes
 \+ externalId (string) - External task id
 \+ taskType (number) - taskTypeId of the task type
 \+ idUserFrom (required, number) - userId of the User that is opening the task
 \+ idUserTo (number) - userId of the User responsable for executing the task
 \+ TeamId (number) - Existing team id at Auvo
 \+ taskDate (string) - Date and time for the execution of the task
 \+ latitude (required, number) - Latitude of the task
 \+ longitude (required, number) - Longitude of the task
 \+ address (required, string) - Address of the task
 \+ orientation (required, string) - Orientation of the task
 \+ priority (required, number) - Priority of the task. 1 - Low \| 2 - Medium \| 3 - High
 \+ questionnaireId (number) - QuestionnaireId of the CheckList(Questionnaire) included in the task
 \+ customerId (number) - CustomerId of the Customer chosen for the task
 \+ checkinType (number) - Checkin type of the task type. 1 - Manual \| 2 - Automatic \| 3 - User
 \+ keyWords (array\[string\]) - list of keywords id.
 \+ sendSatisfactionSurvey (boolean) - Send satisfaction survey for the task.
 \+ financialCategory (string) - Name of the Financial Category

\+ Request (application/json)

 \+ Headers

 Authorization: Bearer token

 \+ Body

 \[\
 { "op": "replace", "path": "orientation", "value": "orientation value" }\
 \]

 \+ Schema

 {
 "externalId": string,
 "taskType": integer,
 "idUserFrom": integer,
 "idUserTo": integer,
 "teamId": integer,
 "taskDate": "yyyy-MM-ddTHH:mm:ss",
 "latitude": integer,
 "longitude": integer,
 "address": string,
 "orientation": string,
 "priority": integer,
 "questionnaireId": integer,
 "customerId": integer
 "checkinType": integer,
 "sendSatisfactionSurvey": boolean,
 "keyWords": array,
 "financialCategory": string
 }

\+ Response 200 (application/json)

 \+ Body

 "result": {
 "taskID": 123,
 "externalId": "3",
 "idUserFrom": 120,
 "idUserTo": 120,
 "customerId": 0,
 "customerExternalId": 10,
 "customerDescription": "Customer x",
 "taskType": 0,
 "creationDate": "2019-04-03T13:06:09",
 "taskDate": "2019-03-26T14:00:00",
 "latitude": 96,
 "longitude": 96,
 "address": "rua rua 123",
 "orientation": "orientation",
 "priority": 1,
 "deliveredOnSmarthPhone": false,
 "deliveredDate": "0001-01-01T00:00:00",
 "finished": false,
 "report": "",
 "visualized": false,
 "visualizedDate": "",
 "checkIn": false,
 "checkInDate": "",
 "checkOut": false,
 "checkOutDate": "",
 "checkinType": 1,
 "keyWords": \[\],
 "inputedKm": 0,
 "adoptedKm": 0,
 "attachments": \[\],
 "questionnaires": \[\],
 "signatureUrl": "",
 "checkInDistance": 0,
 "checkOutDistance": 0,
 "survey": "https://app.auvo.com.br/pesquisasatisfacao/formulario/054599ce-247b-4b34-8dbd-19d47d97de123",
 "taskUrl": "https://app.auvo.com.br/informacoes/tarefa/054599ce-247b-4b34-8dbd-19d47d97d123",
 "pendency": "",
 "dateLastUpdate": "2020-04-03T13:06:09",
 "ticketId": 558,
 "ticketTitle": "Título do ticket",
 "signatureName": "Oliveira Silva",
 "signatureDocument": "00008500100",
 "expense": "2.500.000,00",
 "taskStatus": 1,
 "financialCategory": "Category Name"
 }

\### Task's Products Upsert - Add new products or update existing ones. \[PUT /tasks/{id}/products\]
The body example describes the minimum required attributes to successfully add/update items in the task's list of products. See the \*\*Atributes\*\* or \*\*Json Schema\*\* in the Example section for all allowed attributes. Update or register a new list of products for the task according to product's identifier, the \`ProductId\` attribute. If there is no product in the task's list of products with the provided identifier,the product is added to the list, if it exists, it's updated.

\+ Attributes
 \+ taskProducts (array\[object\])
 \+ ProductId(required, string) - ProductId attribute of the Product.
 \+ DiscountType(string) - A discount type can be 0 - monetary value or 1 - percentage.
 \+ DiscountValue(string) - A value in decimal format according to the discount type specified.
 \+ Quantity(required, string) - The quantity of the product in decimal format.
 \+ Value(required, string) - The unit value of the product in decimal format.

\+ Request (application/json)
 \+ Headers

 Authorization: Bearer token

 \+ Body

 {
 "taskProducts": \[\
 {\
 "ProductId":"419384ad-705c-11eb-bf97-0aa2a285b66a",\
 "Quantity":"1",\
 "Value":"44"\
 }\
 \]
 }

 \+ Schema

 {
 "taskProducts": array
 }

\+ Response 200 (application/json)

 \+ Body

 "result": {
 "taskID": 123,
 "externalId": "",
 "idUserFrom": 123,
 "userFromName": "User",
 "idUserTo": 123,
 "userToName": "User",
 "customerId": 123,
 "customerExternalId": "",
 "customerDescription": "Client",
 "taskType": 0,
 "taskTypeDescription": "",
 "creationDate": "2023-01-20T08:01:12",
 "taskDate": "2023-01-20T08:00:00",
 "latitude": -23.6732872,
 "longitude": -46.4412057,
 "address": "address",
 "orientation": "Orientation",
 "priority": 1,
 "deliveredOnSmarthPhone": false,
 "deliveredDate": "0001-01-01T00:00:00",
 "finished": false,
 "report": "",
 "visualized": false,
 "visualizedDate": "",
 "checkIn": false,
 "checkInDate": "",
 "checkOut": false,
 "checkOutDate": "",
 "checkinType": 1,
 "keyWords": \[\],
 "keyWordsDescriptions": \[\],
 "inputedKm": 0.0,
 "adoptedKm": 0.0,
 "attachments": \[\],
 "questionnaires": \[\],
 "signatureUrl": "",
 "checkInDistance": 0,
 "checkOutDistance": 0,
 "sendSatisfactionSurvey": false,
 "survey": "https://inova.auvo.com.br/pesquisasatisfacao/formulario/c05e12c2-c738-4fb1-8b92-4a1b6cf7bb3a",
 "taskUrl": "https://inova.auvo.com.br/informacoes/tarefa/c05e12c2-c738-4fb1-8b92-4a1b6cf7bb3a?chave=Pre2sGfxpS63X24-PE1Ebg",
 "pendency": "",
 "equipmentsId": \[\],
 "dateLastUpdate": "2023-01-20T08:01:12",
 "ticketId": 0,
 "ticketTitle": "",
 "signatureName": "",
 "signatureDocument": "",
 "expense": "0,00",
 "duration": "",
 "durationDecimal": "",
 "displacementStart": "",
 "products": \[\
 {\
 "productId": "63867f52-b262-410a-a409-cc25ba92ded1",\
 "code": "456",\
 "name": "product name",\
 "description": "product description",\
 "quantity": 1.00,\
 "unitaryValue": 44.00,\
 "totalValue": 44.0000,\
 "userResponsible": "0ca67abc-6d7a-11eb-8b9d-0a23e97fa4da",\
 "userResponsibleCode": 123,\
 "dateRegister": "2023-01-20T08:10:37",\
 "dateEdit": "2023-01-20T08:10:37",\
 "discount": {\
 "value": 0.00,\
 "type": "Valor"\
 }\
 }\
 \],
 "services": \[ \],
 "additionalCosts": \[ \],
 "summary": {
 "totalProducts": 44.0000,
 "totalServices": 0,
 "totalAdditionalCosts": 0,
 "totalValue": 44.0000,
 "discount": {
 "value": 0,
 "type": "0"
 }
 },
 "taskStatus": 1
 }

\### Task's Services Upsert - Add new services or update existing ones. \[PUT /tasks/{id}/services\]
The body example describes the minimum required attributes to successfully add/update items in the task's list of services. See the \*\*Atributes\*\* or \*\*Json Schema\*\* in the Example section for all allowed attributes. Update or register a new list of services for the task according to services's identifier, the \`ServiceId\` attribute. If there is no service in the task's list of services with the provided identifier,the service is added to the list, if it exists, it's updated.

\+ Attributes
 \+ taskServices (array\[object\])
 \+ ServiceId(required, string) - Id attribute of the service.
 \+ DiscountType(string) - A discount type can be 0 - monetary value or 1 - percentage.
 \+ DiscountValue(string) - A value in decimal format according to the discount type specified.
 \+ Quantity(required, string) - The quantity of the service in decimal format.
 \+ Value(required, string) - The unit value of the service in decimal format.

\+ Request (application/json)
 \+ Headers

 Authorization: Bearer token

 \+ Body

 {
 "taskServices": \[\
 {\
 "ServiceId":"419384ad-705c-11eb-bf97-0aa2a285b66a",\
 "Quantity":"1",\
 "Value":"44"\
 }\
 \]
 }

 \+ Schema

 {
 "taskServices": array
 }

\+ Response 200 (application/json)

 \+ Body

 "result": {
 "taskID": 123,
 "externalId": "",
 "idUserFrom": 123,
 "userFromName": "User",
 "idUserTo": 123,
 "userToName": "User",
 "customerId": 123,
 "customerExternalId": "",
 "customerDescription": "Client",
 "taskType": 0,
 "taskTypeDescription": "",
 "creationDate": "2023-01-20T08:01:12",
 "taskDate": "2023-01-20T08:00:00",
 "latitude": -23.6732872,
 "longitude": -46.4412057,
 "address": "address",
 "orientation": "Orientation",
 "priority": 1,
 "deliveredOnSmarthPhone": false,
 "deliveredDate": "0001-01-01T00:00:00",
 "finished": false,
 "report": "",
 "visualized": false,
 "visualizedDate": "",
 "checkIn": false,
 "checkInDate": "",
 "checkOut": false,
 "checkOutDate": "",
 "checkinType": 1,
 "keyWords": \[\],
 "keyWordsDescriptions": \[\],
 "inputedKm": 0.0,
 "adoptedKm": 0.0,
 "attachments": \[\],
 "questionnaires": \[\],
 "signatureUrl": "",
 "checkInDistance": 0,
 "checkOutDistance": 0,
 "sendSatisfactionSurvey": false,
 "survey": "https://inova.auvo.com.br/pesquisasatisfacao/formulario/c05e12c2-c738-4fb1-8b92-4a1b6cf7bb3a",
 "taskUrl": "https://inova.auvo.com.br/informacoes/tarefa/c05e12c2-c738-4fb1-8b92-4a1b6cf7bb3a?chave=Pre2sGfxpS63X24-PE1Ebg",
 "pendency": "",
 "equipmentsId": \[\],
 "dateLastUpdate": "2023-01-20T08:01:12",
 "ticketId": 0,
 "ticketTitle": "",
 "signatureName": "",
 "signatureDocument": "",
 "expense": "0,00",
 "duration": "",
 "durationDecimal": "",
 "displacementStart": "",
 "products": \[ \],
 "services": \[\
 {\
 "id": "45c57e85-d5b8-4224-b430-0e80163eb7e6",\
 "name": "service name",\
 "quantity": 1.0,\
 "unitaryValue": 44.00,\
 "totalValue": 41.8000,\
 "userResponsible": "0ca67abc-6d7a-11eb-8b9d-0a23e97fa4da",\
 "userResponsibleCode": 123,\
 "dateRegister": "2023-01-20T08:01:14",\
 "dateEdit": "2023-01-20T08:01:13",\
 "discount": {\
 "value": 0,\
 "type": "0"\
 }\
 }\
 \],
 "additionalCosts": \[ \],
 "summary": {
 "totalProducts": 0,
 "totalServices": 44.0000,
 "totalAdditionalCosts": 0,
 "totalValue": 44.0000,
 "discount": {
 "value": 0,
 "type": "0"
 }
 },
 "taskStatus": 1
 }

\### Task's Additional Costs Upsert - Add new additional costs or update existing ones. \[PUT /tasks/{id}/additional-costs\]
The body example describes the minimum required attributes to successfully add/update items in the task's list of additional costs. See the \*\*Atributes\*\* or \*\*Json Schema\*\* in the Example section for all allowed attributes. Update or register a new list of additional costs for the task according to additional costs's identifier, the \`AdditionalCostId\` attribute. If there is no additional cost in the task's list of additional costs with the provided identifier,the additional cost is added to the list, if it exists, it's updated.

\+ Attributes
 \+ taskAdditionalCosts (array\[object\])
 \+ AdditionalCostId(required, string) - AdditionalCostId attribute of the Additional cost.
 \+ DiscountType(string) - A discount type can be 0 - monetary value or 1 - percentage.
 \+ DiscountValue(string) - A value in decimal format according to the discount type specified.
 \+ Quantity(required, string) - The quantity of the additional cost in decimal format.
 \+ Value(required, string) - The unit value of the additional cost in decimal format.

\+ Request (application/json)
 \+ Headers

 Authorization: Bearer token

 \+ Body

 {
 "taskAdditionalCosts": \[\
 {\
 "AdditionalCostId":"aa3ca4d0-8154-4c37-978d-49531d17d41c",\
 "Value":"361"\
 }\
 \]
 }

 \+ Schema

 {
 "taskAdditionalCosts": array
 }

\+ Response 200 (application/json)

 \+ Body

 "result": {
 "taskID": 123,
 "externalId": "",
 "idUserFrom": 123,
 "userFromName": "User",
 "idUserTo": 123,
 "userToName": "User",
 "customerId": 123,
 "customerExternalId": "",
 "customerDescription": "Client",
 "taskType": 0,
 "taskTypeDescription": "",
 "creationDate": "2023-01-20T08:01:12",
 "taskDate": "2023-01-20T08:00:00",
 "latitude": -23.6732872,
 "longitude": -46.4412057,
 "address": "address",
 "orientation": "Orientation",
 "priority": 1,
 "deliveredOnSmarthPhone": false,
 "deliveredDate": "0001-01-01T00:00:00",
 "finished": false,
 "report": "",
 "visualized": false,
 "visualizedDate": "",
 "checkIn": false,
 "checkInDate": "",
 "checkOut": false,
 "checkOutDate": "",
 "checkinType": 1,
 "keyWords": \[\],
 "keyWordsDescriptions": \[\],
 "inputedKm": 0.0,
 "adoptedKm": 0.0,
 "attachments": \[\],
 "questionnaires": \[\],
 "signatureUrl": "",
 "checkInDistance": 0,
 "checkOutDistance": 0,
 "sendSatisfactionSurvey": false,
 "survey": "https://inova.auvo.com.br/pesquisasatisfacao/formulario/c05e12c2-c738-4fb1-8b92-4a1b6cf7bb3a",
 "taskUrl": "https://inova.auvo.com.br/informacoes/tarefa/c05e12c2-c738-4fb1-8b92-4a1b6cf7bb3a?chave=Pre2sGfxpS63X24-PE1Ebg",
 "pendency": "",
 "equipmentsId": \[\],
 "dateLastUpdate": "2023-01-20T08:01:12",
 "ticketId": 0,
 "ticketTitle": "",
 "signatureName": "",
 "signatureDocument": "",
 "expense": "0,00",
 "duration": "",
 "durationDecimal": "",
 "displacementStart": "",
 "products": \[ \],
 "services": \[ \],
 "additionalCosts": \[\
 {\
 "additionalCostId":"419384ad-705c-11eb-bf97-0aa2a285b66a",\
 "code": 0,\
 "name": "additionalCost name",\
 "unitaryValue": 44.00,\
 "userResponsible": "0ca67abc-6d7a-11eb-8b9d-0a23e97fa4da",\
 "userResponsibleCode": 123,\
 "dateRegister": "2023-01-20T08:01:15",\
 "dateEdit": "2023-01-20T08:01:14"\
 }\
 \],
 "summary": {
 "totalProducts": 0,
 "totalServices": 0,
 "totalAdditionalCosts": 44.0000,
 "totalValue": 44.0000,
 "discount": {
 "value": 0,
 "type": "0"
 }
 },
 "taskStatus": 1
 }

\### Delete products from a task list of products \[DELETE /tasks/{id}/products\]

\+ Attributes
 \+ \[\] (array\[string\])
 \+ ProductId (string) - ProductId attribute of the Product.

\+ Request (application/json)

 \+ Headers

 Authorization: Bearer token

 \+ Body

 \[\
 "419384ad-705c-11eb-bf97-0aa2a285b66a"\
 \]

\+ Parameters

 \+ id (number) ... \`taskID\` attribute of the \`Task\` to delete products.


\+ Response 204

\### Delete services from a task list of services \[DELETE /tasks/{id}/services\]
\+ Attributes
 \+ \[\] (array\[string\])
 \+ ServiceId (string) - ServiceId attribute of the Service.

\+ Request (application/json)

 \+ Headers

 Authorization: Bearer token

 \+ Body

 \[\
 "004916fa-5a2c-4500-a1c5-3208fdb92f85"\
 \]

\+ Parameters

 \+ id (number) ... \`id\` of the task to delete services.


\+ Response 204

\### Delete additional costs from a task list of additional costs \[DELETE /tasks/{id}/additional-costs\]

\+ Attributes
 \+ \[\] (array\[string\])
 \+ AdditionalCostId (string) - AdditionalCostId attribute of the AdditionalCost.

\+ Request (application/json)

 \+ Headers

 Authorization: Bearer token

 \+ Body

 \[\
 "aa3ca4d0-8154-4c37-978d-49531d17d41c"\
 \]

\+ Parameters

 \+ id (number) ... \`id\` of the task to delete additional costs.


\+ Response 204

\### Edit Task attachment \[PUT /tasks/{id}/attachments\]
To update a \`Task\` attachment, send a JSON with updated value to the \`Task\` id.

\+ Attributes
 \+ removeAllAttachmentsInsertedByMe (boolean) - this option will remove all the previous attachments inserted by the requester in the task
 \+ attachments (array\[object\])
 \+ name(required, string) - the name MUST contain the file type (Ex. "my\_file.pdf")
 \+ file(required, string) - base 64 file.

\+ Request (application/json)
 \+ Headers

 Authorization: Bearer token

 \+ Body

 {
 "removeAllAttachmentsInsertedByMe": false,
 "attachments": \[\
 {\
 "name": "my\_file.pdf",\
 "file": "base64 encoded file"\
 }\
 \]
 }

 \+ Schema

 {
 "removeAllAttachmentsInsertedByMe": boolean,
 "attachments": array
 }

\+ Response 200 (application/json)

 \+ Body

 "result":{
 "taskID": 23,
 "externalId": "123",
 "idUserFrom": 123,
 "idUserTo": 123,
 "customerId": 456,
 "customerExternalId": 10,
 "customerDescription": "Customer x",
 "taskType": 23,
 "creationDate": "2016-03-23T14:10:35",
 "taskDate": "2016-03-23T18:00:00",
 "latitude": -16.6872086111083,
 "longitude": -49.2995542287827,
 "address": "avenue X",
 "orientation": "Go get a beer!",
 "priority": 1,
 "deliveredOnSmarthPhone": true,
 "deliveredDate": "2016-03-23T14:11:31",
 "finished": true,
 "report": "ok",
 "visualized": true,
 "visualizedDate": "2016-03-23T14:12:00",
 "checkIn": true,
 "checkInDate": "2016-03-23T18:05:00",
 "checkOut": true,
 "checkOutDate": "2016-03-23T18:10:00",
 "checkinType": 1,
 "keyWords": \[\
 "keyword id"\
 \],
 "inputedKm": 10,
 "adoptedKm": 11,
 "attachments":\[\
 {\
 "id": "1",\
 "url": "",\
 "attachmentType": 1,\
 "subtitle": "",\
 "description": "",\
 "extension": ""\
 }\
 \],
 "questionnaires":\[\
 {\
 "itemId": "1",\
 "questionnaireId": "",\
 "questionnaireDescription": 1,\
 "answers": \[\
 {\
 "questionId": "1",\
 "questionDescription": "",\
 "replyId": 1,\
 "reply": 1,\
 "replyDate": "2016-03-23T18:10:00"\
 }\
 \]\
 }\
 \],
 "signatureUrl": "signature url",
 "checkInDistance": 0,
 "checkOutDistance": 0,
 "survey": "",
 "taskUrl": "",
 "pendency": "",
 "dateLastUpdate": "2016-03-23T18:10:00",
 "ticketId": 558,
 "ticketTitle": "Título do ticket",
 "signatureName": "Oliveira Silva",
 "signatureDocument": "00008500100",
 "expense": "2.500.000,00",
 "taskStatus": 1
 }

\### Delete a Task \[DELETE /tasks/{id}\]

\+ Request (application/json)

 \+ Headers

 Authorization: Bearer token

\+ Parameters

 \+ id (number) ... \`taskID\` of the task to delete.

\+ Response 204

\### Retrieves a list of Tasks \[GET/tasks/?paramFilter={paramFilter}&page={page}&pageSize={pageSize}&order={order}&selectfields={selectfields}\]

The "taskStatus" task return attribute has the following return values:

\\* Opened = 1,
\\* InDisplacement = 2,
\\* CheckedIn = 3,
\\* CheckedOut = 4,
\\* Finished = 5,
\\* Paused = 6

\+ Parameters
 \+ paramFilter (required, string) ... paramFilter must be json encoded string.
 \+ taskID (string) - The task id
 \+ idUserTo (number) - The user tp id
 \+ startDate (required, string) - Task start date, filter date ("yyyy-MM-ddTHH:mm:ss").
 \+ endDate (required, string) - Task end date, filter date ("yyyy-MM-ddTHH:mm:ss").
 \+ dateLastUpdate (string) - The last update date of the task, filter date ("yyyy-MM-ddTHH:mm:ss").
 \+ customerId (number) - The customer id
 \+ teamId (number) - The team id
 \+ type (number) - The task type id
 \+ customerGroupId (number) - The customer group id
 \+ status (number) - 0 - unfinished: 0 \| 1 - finalizedAutomatically \| 2 - finalizedManually \| 3 - finalizedAutomaticallyOrManually \| 4 - all \| 5 - withPendency \| 6 - startedOrEnded
 \+ orientation (string) - Orientation of the task
 \+ tags (string) - Tags id separated by commas
 \+ priority (string) - Priority of the task. 1 - Low \| 2 - Medium \| 3 - High
 \+ externalId (string) - Task external ids. Allow multiples, separated by comma
 \+ page (int) ... Page of the selection. Default 1.
 \+ pageSize (int) ... Amount of records of the selection. Default 10.
 \+ order (string) ... "asc"/0 for Ascending or "desc"/1 for Descending. Default "asc".
 \+ selectfields (optional, string) ... For all fields, use empty string. To select fields, use the properties of the returned object separated by commas.

\+ Request (application/json)

 \+ Headers

 Authorization: Bearer token

\+ Response 200 (application/json)

 \+ Body

 "result": {
 "entityList":\[\
 {\
 "taskID": 23,\
 "externalId": "123",\
 "idUserFrom": 123,\
 "userFromName": "Paulo",\
 "idUserTo": 123,\
 "userToName": "Colaborador sem ponto base",\
 "customerId": 456,\
 "customerExternalId": 10,\
 "customerDescription": "Customer x",\
 "taskType": 23,\
 "taskTypeDescription": "Edição automatizada 897263119",\
 "creationDate": "2016-03-23T14:10:35",\
 "taskDate": "2016-03-23T18:00:00",\
 "latitude": -16.6872086111083,\
 "longitude": -49.2995542287827,\
 "address": "avenue X",\
 "orientation": "Go get a beer!",\
 "priority": 1,\
 "deliveredOnSmarthPhone": true,\
 "deliveredDate": "2016-03-23T14:11:31",\
 "finished": true,\
 "report": "ok",\
 "visualized": true,\
 "visualizedDate": "2016-03-23T14:12:00",\
 "checkIn": true,\
 "checkInDate": "2016-03-23T18:05:00",\
 "checkOut": true,\
 "checkOutDate": "2016-03-23T18:10:00",\
 "checkinType": 1,\
 "keyWords": \[\
 "keyword id"\
 \],\
 "keyWordsDescriptions": \[\
 "Description of keywords"\
 \],\
 "inputedKm": 10,\
 "adoptedKm": 11,\
 "attachments":\[\
 {\
 "id": "1",\
 "url": "",\
 "attachmentType": 1,\
 "subtitle": "",\
 "description": "",\
 "extension": ""\
 }\
 \],\
 "questionnaires":\[\
 {\
 "itemId": "1",\
 "questionnaireId": "",\
 "questionnaireDescription": 1,\
 "answers": \[\
 {\
 "questionId": "1",\
 "questionDescription": "",\
 "replyId": 1,\
 "reply": 1,\
 "replyDate": "2016-03-23T18:10:00"\
 }\
 \]\
 }\
 \],\
 "equipmentsId": \[109638, 109753\],\
 "signatureUrl": "signature url",\
 "checkInDistance": 0,\
 "checkOutDistance": 0,\
 "sendSatisfactionSurvey": true,\
 "survey": "",\
 "taskUrl": "",\
 "pendency": "",\
 "dateLastUpdate": "2016-03-23T18:10:00",\
 "ticketId": 558,\
 "ticketTitle": "Título do ticket",\
 "signatureName": "Oliveira Silva",\
 "signatureDocument": "00008500100",\
 "expense": "2.500.000,00",\
 "duration": "",\
 "durationDecimal": "",\
 "displacementStart": "",\
 "products": \[{\
 "productId": "63867f52-b262-410a-a409-cc25ba92ded1",\
 "code": "456",\
 "name": null,\
 "description": null,\
 "quantity": 0.0,\
 "unitaryValue": 0.0,\
 "totalValue": 0.0,\
 "userResponsible": null,\
 "userResponsibleCode": 0,\
 "dateRegister": null,\
 "dateEdit": null\
 "discount": {\
 "value": 0.00,\
 "type": "Valor"\
 }\
 }\
 \],\
 "services": \[{\
 "id": "00000000-0000-0000-0000-000000000000",\
 "name": null,\
 "quantity": 0.0,\
 "unitaryValue": 0.0,\
 "totalValue": 0.0,\
 "userResponsible": null,\
 "userResponsibleCode": 0,\
 "dateRegister": null,\
 "dateEdit": null\
 "discount": {\
 "value": 0.00,\
 "type": "Valor"\
 }\
 }\
 \],\
 "additionalCosts": \[{\
 "additionalCostId": "419384ad-705c-11eb-bf97-0aa2a285b66a",\
 "code": 0,\
 "name": null,\
 "unitaryValue": 0.0,\
 "userResponsible": null,\
 "userResponsibleCode": 0,\
 "dateRegister": null,\
 "dateEdit": null\
 }\],\
 "summary": {\
 "totalProducts": 0.0,\
 "totalServices": 0.0,\
 "totalAdditionalCosts": 0.0,\
 "totalValue": 0.0,\
 "discount": {\
 "value": 0.00,\
 "type": "Valor"\
 }\
 },\
 "estimatedDuration": "00:00:00",\
 "taskStatus": 1,\
 "financialCategory": ""\
 }\
 \],
 "pagedSearchReturnData": {
 "order": 0,
 "pageSize": 1,
 "page": 1,
 "totalItems": 2
 },
 "links": \[\
 {\
 "href": "https://api.auvo.com.br/v2/Tasks?ParamFilter=%7B%0D%0A%20%20%20%22StartDate%22%3A%222010-02-23T15%3A50%3A49%22,%0D%0A%20%20%20%22EndDate%22%3A%222019-04-24T15%3A50%3A49%22&Page=1&PageSize=1&Order=Asc",\
 "rel": "self",\
 "method": "GET"\
 },\
 {\
 "href": "https://api.auvo.com.br/v2/Tasks?ParamFilter=%7B%0D%0A%20%20%20%22StartDate%22%3A%222010-02-23T15%3A50%3A49%22,%0D%0A%20%20%20%22EndDate%22%3A%222019-04-24T15%3A50%3A49%22&Page=2&PageSize=1&Order=Asc",\
 "rel": "nextPage",\
 "method": "GET"\
 }\
 \]
 }

\### Retrieves a list of Deleted Tasks \[GET/tasks/getdeletedtasks?paramFilter={paramFilter}&page={page}&pageSize={pageSize}&order={order}&selectfields={selectfields}\]

The "taskStatus" task return attribute has the following return values:

\\* Opened = 1,
\\* InDisplacement = 2,
\\* CheckedIn = 3,
\\* CheckedOut = 4,
\\* Finished = 5,
\\* Paused = 6

\+ Parameters
 \+ paramFilter (required, string) ... paramFilter must be json encoded string.
 \+ taskID (string) - The task id
 \+ idUserTo (number) - The user tp id
 \+ startDate (required, string) - Task start date, filter date ("yyyy-MM-ddTHH:mm:ss").
 \+ endDate (required, string) - Task end date, filter date ("yyyy-MM-ddTHH:mm:ss").
 \+ dateLastUpdate (string) - The last update date of the task, filter date ("yyyy-MM-ddTHH:mm:ss").
 \+ customerId (number) - The customer id
 \+ teamId (number) - The team id
 \+ type (number) - The task type id
 \+ customerGroupId (number) - The customer group id
 \+ status (number) - 0 - unfinished: 0 \| 1 - finalizedAutomatically \| 2 - finalizedManually \| 3 - finalizedAutomaticallyOrManually \| 4 - all \| 5 - withPendency \| 6 - startedOrEnded
 \+ orientation (string) - Orientation of the task
 \+ tags (string) - Tags id separated by commas
 \+ priority (string) - Priority of the task. 1 - Low \| 2 - Medium \| 3 - High
 \+ externalId (string) - Task external ids. Allow multiples, separated by comma
 \+ page (int) ... Page of the selection. Default 1.
 \+ pageSize (int) ... Amount of records of the selection. Default 10.
 \+ order (string) ... "asc"/0 for Ascending or "desc"/1 for Descending. Default "asc".
 \+ selectfields (optional, string) ... For all fields, use empty string. To select fields, use the properties of the returned object separated by commas.

\+ Request (application/json)

 \+ Headers

 Authorization: Bearer token

\+ Response 200 (application/json)

 \+ Body

 "result": {
 "entityList":\[\
 {\
 "taskID": 23,\
 "externalId": "123",\
 "idUserFrom": 123,\
 "userFromName": "Paulo",\
 "idUserTo": 123,\
 "userToName": "Colaborador sem ponto base",\
 "customerId": 456,\
 "customerExternalId": 10,\
 "customerDescription": "Customer x",\
 "taskType": 23,\
 "taskTypeDescription": "Edição automatizada 897263119",\
 "creationDate": "2016-03-23T14:10:35",\
 "taskDate": "2016-03-23T18:00:00",\
 "latitude": -16.6872086111083,\
 "longitude": -49.2995542287827,\
 "address": "avenue X",\
 "orientation": "Go get a beer!",\
 "priority": 1,\
 "deliveredOnSmarthPhone": true,\
 "deliveredDate": "2016-03-23T14:11:31",\
 "finished": true,\
 "report": "ok",\
 "visualized": true,\
 "visualizedDate": "2016-03-23T14:12:00",\
 "checkIn": true,\
 "checkInDate": "2016-03-23T18:05:00",\
 "checkOut": true,\
 "checkOutDate": "2016-03-23T18:10:00",\
 "checkinType": 1,\
 "keyWords": \[\
 "keyword id"\
 \],\
 "keyWordsDescriptions": \[\
 "Description of keywords"\
 \],\
 "inputedKm": 10,\
 "adoptedKm": 11,\
 "attachments":\[\
 {\
 "id": "1",\
 "url": "",\
 "attachmentType": 1,\
 "subtitle": "",\
 "description": "",\
 "extension": ""\
 }\
 \],\
 "questionnaires":\[\
 {\
 "itemId": "1",\
 "questionnaireId": "",\
 "questionnaireDescription": 1,\
 "answers": \[\
 {\
 "questionId": "1",\
 "questionDescription": "",\
 "replyId": 1,\
 "reply": 1,\
 "replyDate": "2016-03-23T18:10:00"\
 }\
 \]\
 }\
 \],\
 "equipmentsId": \[109638, 109753\],\
 "signatureUrl": "signature url",\
 "checkInDistance": 0,\
 "checkOutDistance": 0,\
 "sendSatisfactionSurvey": true,\
 "survey": "",\
 "taskUrl": "",\
 "pendency": "",\
 "dateLastUpdate": "2016-03-23T18:10:00",\
 "ticketId": 558,\
 "ticketTitle": "Título do ticket",\
 "signatureName": "Oliveira Silva",\
 "signatureDocument": "00008500100",\
 "expense": "2.500.000,00",\
 "duration": "",\
 "durationDecimal": "",\
 "displacementStart": "",\
 "products": \[{\
 "productId": "63867f52-b262-410a-a409-cc25ba92ded1",\
 "code": "456",\
 "name": null,\
 "description": null,\
 "quantity": 0.0,\
 "unitaryValue": 0.0,\
 "totalValue": 0.0,\
 "userResponsible": null,\
 "userResponsibleCode": 0,\
 "dateRegister": null,\
 "dateEdit": null\
 "discount": {\
 "value": 0.00,\
 "type": "Valor"\
 }\
 }\
 \],\
 "services": \[{\
 "id": "00000000-0000-0000-0000-000000000000",\
 "name": null,\
 "quantity": 0.0,\
 "unitaryValue": 0.0,\
 "totalValue": 0.0,\
 "userResponsible": null,\
 "userResponsibleCode": 0,\
 "dateRegister": null,\
 "dateEdit": null\
 "discount": {\
 "value": 0.00,\
 "type": "Valor"\
 }\
 }\
 \],\
 "additionalCosts": \[{\
 "additionalCostId": "419384ad-705c-11eb-bf97-0aa2a285b66a",\
 "code": 0,\
 "name": null,\
 "unitaryValue": 0.0,\
 "userResponsible": null,\
 "userResponsibleCode": 0,\
 "dateRegister": null,\
 "dateEdit": null\
 }\],\
 "summary": {\
 "totalProducts": 0.0,\
 "totalServices": 0.0,\
 "totalAdditionalCosts": 0.0,\
 "totalValue": 0.0,\
 "discount": {\
 "value": 0.00,\
 "type": "Valor"\
 }\
 },\
 "estimatedDuration": "00:00:00",\
 "taskStatus": 1,\
 "financialCategory": ""\
 }\
 \],
 "pagedSearchReturnData": {
 "order": 0,
 "pageSize": 1,
 "page": 1,
 "totalItems": 2
 },
 "links": \[\
 {\
 "href": "https://api.auvo.com.br/v2/Tasks?ParamFilter=%7B%0D%0A%20%20%20%22StartDate%22%3A%222010-02-23T15%3A50%3A49%22,%0D%0A%20%20%20%22EndDate%22%3A%222019-04-24T15%3A50%3A49%22&Page=1&PageSize=1&Order=Asc",\
 "rel": "self",\
 "method": "GET"\
 },\
 {\
 "href": "https://api.auvo.com.br/v2/Tasks?ParamFilter=%7B%0D%0A%20%20%20%22StartDate%22%3A%222010-02-23T15%3A50%3A49%22,%0D%0A%20%20%20%22EndDate%22%3A%222019-04-24T15%3A50%3A49%22&Page=2&PageSize=1&Order=Asc",\
 "rel": "nextPage",\
 "method": "GET"\
 }\
 \]
 }

\# Group Customers

\## Customer \[/customers/{id}\]

\+ Parameters

 \+ id (number) ... \`customerId\` attribute of the \`Customer\`.

\+ Model

 \+ Body

 "result":{
 "id": 42,
 "externalId": "906",
 "description": "Terêscio",
 "cpfCnpj": "90614997000162",
 "phoneNumber": \["5566123123"\],
 "email": \["terenscio@customer.com"\],
 "manager": "Oristides",
 "managerJobPosition": "Manager",
 "note": "nothing to say",
 "address": "lake yululu",
 "latitude": -16.6872086111083,
 "longitude": -49.2995542287827,
 "maximumVisitTime": 1,
 "unitMaximumTime": 1,
 "groupsId": \[0\],
 "managerTeamsId": \[0\],
 "managersId": \[0\],
 "segmentId": 1,
 "active": false,
 "adressComplement": "adress complemente",
 "creationDate": "2019-04-15T15:00:00",
 "contacts": \[\
 {\
 "id": 23328,\
 "name": "contact.name",\
 "jobPosition": "",\
 "email": "contact.email@gmail.com",\
 "phone": ""\
 }\
 \],
 "dateLastUpdate": "2020-04-23T15:57:08",
 "uriAnexos": \["https://auvo-producao.s3.amazonaws.com/anexos\_clientes/12d53e24-9e5a-4319-a070-458e18260321.jpeg"\],
 }

\### Retrieve a Customer \[GET/customers/{id}\]

\+ Request (application/json)

 \+ Headers

 Authorization: Bearer token

\+ Response 200 (application/json)

 \[Customer\]\[\]

\+ Response 400 (application/json)

 When making a request with invalid options, status code 400 will be returned. For example, passing an invalid \`id\` parameter.

 \+ Body

 {
 "id": \[\
 "The value 'x' is not valid."\
 \]
 }

\+ Response 404

 When the resource with the specified id does not exist.


\### Add a new Customer \[POST /customers/\]

The body example describes the minimum required attributes to successfully add a customer. See the \*\*Atributes\*\* or \*\*Json Schema\*\* in the Example section for all allowed attributes.

\+ Attributes
 \+ externalId (string) - External customer id outside auvos application
 \+ name (required, string) - Customer name
 \+ phoneNumber (array\[string\]) - Array of customer phone number(numbers only)
 \+ email (array\[string\]) - Array of customer contact email
 \+ manager (string) - customer manager
 \+ managerJobPosition (string) - job position of the customer manager
 \+ note (string) - note about the customer
 \+ address (string) - customer address
 \+ latitude (string) - latitude of the customer address
 \+ longitude (string) - longitude of the customer address
 \+ maximumVisitTime (number) - Customer maximum visit time duration
 \+ UnitMaximumTime (number) - Unit maximum time
 \+ cpfCnpj (string) - customer CPF/CNPJ
 \+ groupsId (array\[number\]) - Array of groups id (must exist in auvo)
 \+ managerTeamsId (array\[number\]) - Array of managers team id (must exist in auvo)
 \+ managersId (array\[number\]) - Array of managers id (must exist in auvo)
 \+ active (boolean) - Customer is active
 \+ segmentId (number) - id of a registered segment (must exist in auvo)
 \+ contacts (array\[object\])
 \+ name(required, string)
 \+ email(string)
 \+ jobPosition(string)
 \+ phone(string)
 \+ adressComplement (string) - Adress complement
 \+ attachments (array\[object\])
 \+ name(required, string) - the name MUST contain the file type (Ex. "my\_file.pdf")
 \+ file(required, string) - base 64 file.

\+ Request (application/json)

 \+ Headers

 Authorization: Bearer token

 \+ Body

 {
 "externalId": "906",
 "name": "Terêscio",
 "cpfCnpj": "90614997000162",
 "phoneNumber": \["5566123123"\],
 "email": \["terenscio@customer.com"\],
 "manager": "Oristides",
 "managerJobPosition": "Manager",
 "note": "nothing to say",
 "address": "lake yululu",
 "latitude": -16.6872086111083,
 "longitude": -49.2995542287827,
 "maximumVisitTime": 1,
 "unitMaximumTime": 1,
 "groupsId": \[0\],
 "managerTeamsId": \[0\],
 "managersId": \[0\],
 "segmentId": 1,
 "active": false,
 "adressComplement": "adress complemente",
 "creationDate": "2019-04-15T15:00:00",
 "contacts": \[\
 {\
 "name": "contact.name",\
 "email": "contact.email@gmail.com",\
 "jobPosition": "",\
 "phone": ""\
 },\
 {\
 "name": "contact.name.2",\
 "email": "contact.email.2@hotmail.com",\
 "jobPosition": "",\
 "phone": ""\
 }\
 \],
 "dateLastUpdate": "2019-04-15T15:00:00",
 "attachments": \[\
 {\
 "name": "image.jpeg",\
 "file": "iVBORw0KGgoAAAANSUhEUgAAAH4AAABWCAYAAAAJ3CLTAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAB8BJ"\
 }\
 \]
 }

 \+ Schema

 {
 "externalId": string,
 "name": string,
 "cpfCnpj":string,
 "phoneNumber": \[string\],
 "email": \[string\],
 "manager": string,
 "managerJobPosition": string,
 "note": string,
 "address": string,
 "latitude": number,
 "longitude": number,
 "maximumVisitTime": number,
 "unitMaximumTime": number,
 "groupsId": \[number\],
 "managerTeamsId": \[number\],
 "managersId": \[number\],
 "segmentId": number,
 "active": ?boolean,
 "contacts": array\[object\],
 "adressComplement": string,
 "attachments": array\[object\],
 }

\+ Response 201 (application/json)

 \+ Body

 "result":{
 "id": 42,
 "externalId": "906",
 "name": "Terêscio",
 "cpfCnpj": "90614997000162",
 "phoneNumber": \["5566123123"\],
 "email": \["terenscio@customer.com"\],
 "manager": "Oristides",
 "managerJobPosition": "Manager",
 "note": "nothing to say",
 "address": "lake yululu",
 "latitude": -16.6872086111083,
 "longitude": -49.2995542287827,
 "maximumVisitTime": 1,
 "unitMaximumTime": 1,
 "groupsId": \[0\],
 "managerTeamsId": \[0\],
 "managersId": \[0\],
 "segmentId": 1,
 "active": false,
 "adressComplement": "adress complemente",
 "creationDate": "2019-04-15T15:00:00",
 "contacts": \[\
 {\
 "id": 23377,\
 "name": "contact.name",\
 "email": "contact.email@gmail.com",\
 "jobPosition": "",\
 "phone": ""\
 },\
 {\
 "id": 23378,\
 "name": "contact.name.2",\
 "email": "contact.email.2@hotmail.com",\
 "jobPosition": "",\
 "phone": ""\
 }\
 \],
 "dateLastUpdate": "2019-04-15T15:00:00",
 "uriAnexos": \["https://auvo-producao.s3.amazonaws.com/anexos\_clientes/12d53e24-9e5a-4319-a070-458e18260321.jpeg"\],
 }

\### Upsert - Add a new Customer or update an existing one \[PUT /customers/\]

The body example describes the minimum required attributes to successfully add/update a customer. See the \*\*Atributes\*\* or \*\*Json Schema\*\* in the Example section for all allowed attributes. Update or register a new customer
according to one of its identifier, \`id\` OR \`externalId\`. If there is no customer with the provided identifier, create a new one, if it exists, update it. Returns HTTP status code 200 if the task was updated and 201
if it was created.

\+ Attributes
 \+ id (number) - identifier of a registered customer
 \+ externalId (string) - External customer id outside auvos application
 \+ description (required, string) - Customer name
 \+ phoneNumber (array\[string\]) - Array of customer phone number(numbers only)
 \+ email (array\[string\]) - Array of customer contact email
 \+ manager (string) - customer manager
 \+ managerJobPosition (string) - job position of the customer manager
 \+ note (string) - note about the customer
 \+ address (string) - customer address
 \+ latitude (string) - latitude of the customer address
 \+ longitude (string) - longitude of the customer address
 \+ maximumVisitTime (number) - Customer maximum visit time duration
 \+ UnitMaximumTime (number) - Unit maximum time
 \+ cpfCnpj (string) - customer CPF/CNPJ
 \+ groupsId (array\[number\]) - Array of groups id (must exist in auvo)
 \+ managerTeamsId (array\[number\]) - Array of managers team id (must exist in auvo)
 \+ managersId (array\[number\]) - Array of managers id (must exist in auvo)
 \+ active (boolean) - Customer is active
 \+ segmentId (number) - id of a registered segment (must exist in auvo)
 \+ contacts (array\[object\])
 \+ id(\[number) - "id": identifier of existing contact\
 \+ name(required, string)\
 \+ email(string)\
 \+ jobPosition(string)\
 \+ phone(string)\
 \+ adressComplement (string) - Adress complement\
 \+ attachments (array\[object\])\
 \+ name(required, string) - the name MUST contain the file type (Ex. "my\_file.pdf")\
 \+ file(required, string) - base 64 file.\
\
\+ Request (application/json)\
\
 \+ Headers\
\
 Authorization: Bearer token\
\
 \+ Body\
\
 {\
 "externalId": "906",\
 "description": "Terêscio",\
 "cpfCnpj": "90614997000162",\
 "phoneNumber": \["5566123123"\],\
 "email": \["terenscio@customer.com"\],\
 "manager": "Oristides",\
 "managerJobPosition": "Manager",\
 "note": "nothing to say",\
 "address": "lake yululu",\
 "latitude": -16.6872086111083,\
 "longitude": -49.2995542287827,\
 "maximumVisitTime": 1,\
 "unitMaximumTime": 1,\
 "groupsId": \[0\],\
 "managerTeamsId": \[0\],\
 "managersId": \[0\],\
 "segmentId": 1,\
 "active": false,\
 "adressComplement": "adress complement",\
 "creationDate": "2019-04-15T15:00:00",\
 "dateLastUpdate": "2019-04-15T15:00:00",\
 "contacts": \[\
 {\
 "id": 23377,\
 "name": "contact.name",\
 "email": "contact.email@gmail.com",\
 "jobPosition": "",\
 "phone": ""\
 },\
 {\
 "id": 23378,\
 "name": "contact.name.2",\
 "email": "contact.email.2@hotmail.com",\
 "jobPosition": "manager",\
 "phone": ""\
 },\
 {\
 "name": "contact.name.3",\
 "email": "contact.email.3@hotmail.com",\
 "jobPosition": "",\
 "phone": ""\
 }\
 \],\
 "attachments": \[\
 {\
 "name":"image.jpeg",\
 "file":"iVBORw0KGgoAAAANSUhEUgAAAH4AAABWCAYAAAAJ3CLTAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAB8BJREFUeNrsnV1sFFUUx....."\
 }\
 \]\
 }\
\
 \+ Schema\
\
 {\
 "externalId": string,\
 "description": string,\
 "cpfCnpj":string,\
 "phoneNumber": \[string\],\
 "email": \[string\],\
 "manager": string,\
 "managerJobPosition": string,\
 "note": string,\
 "address": string,\
 "latitude": number,\
 "longitude": number,\
 "maximumVisitTime": number,\
 "unitMaximumTime": number,\
 "groupsId": \[number\],\
 "managerTeamsId": \[number\],\
 "managersId": \[number\],\
 "segmentId": number,\
 "active": ?boolean,\
 "contactes": (array\[object\]),\
 "adressComplement": string,\
 "attachments": \[object\]\
 }\
\
\+ Response 201 (application/json)\
\
 \+ Body\
\
 "result":{\
 "id": 42,\
 "externalId": "906",\
 "description": "Terêscio",\
 "cpfCnpj": "90614997000162",\
 "phoneNumber": \["5566123123"\],\
 "email": \["terenscio@customer.com"\],\
 "manager": "Oristides",\
 "managerJobPosition": "Manager",\
 "note": "nothing to say",\
 "address": "lake yululu",\
 "latitude": -16.6872086111083,\
 "longitude": -49.2995542287827,\
 "maximumVisitTime": 1,\
 "unitMaximumTime": 1,\
 "groupsId": \[0\],\
 "managerTeamsId": \[0\],\
 "managersId": \[0\],\
 "segmentId": 1,\
 "active": false,\
 "AdressComplement": "adress complemente",\
 "creationDate": "2019-04-15T15:00:00",\
 "dateLastUpdate": "2019-04-15T15:00:00",\
 "contacts": \[\
 {\
 "id": 23377,\
 "name": "contact.name",\
 "email": "contact.email@gmail.com",\
 "jobPosition": "",\
 "phone": ""\
 },\
 {\
 "id": 23378,\
 "name": "contact.name.2",\
 "email": "contact.email.2@hotmail.com",\
 "jobPosition": "manager",\
 "phone": ""\
 },\
 {\
 "id": 23379,\
 "name": "contact.name.3",\
 "email": "contact.email.3@hotmail.com",\
 "jobPosition": "",\
 "phone": ""\
 }\
 \],\
 "uriAnexos": \["https://auvo-producao.s3.amazonaws.com/anexos\_clientes/12d53e24-9e5a-4319-a070-458e18260321.jpeg"\]\
 }\
\
\### Edit a Customer \[PATCH /customers/{id}\]\
To update a \`Customer\`, send a JSONPatchDocument with updated value for one or more of the \`CustomerPatch\` attributes. See the \*\*Atributes\*\* or \*\*Json Schema\*\* in the Example section for all allowed attributes.\
JsonPatch example: { "op": "replace", "path": "orientation", "value": "orientation value" }\
For more information on JsonPatch, visit: \`http://jsonpatch.com/\`.\
\
\+ Attributes\
 \+ externalId (string) - External customer id outside auvos application\
 \+ name (required, string) - Customer name\
 \+ phoneNumber (array\[string\]) - Array of customer phone number(numbers only)\
 \+ email (array\[string\]) - Array of customer contact email\
 \+ manager (string) - customer manager\
 \+ managerJobPosition (string) - job position of the customer manager\
 \+ note (string) - note about the customer\
 \+ address (required, string) - customer address\
 \+ latitude (string) - latitude of the customer address\
 \+ longitude (string) - longitude of the customer address\
 \+ maximumVisitTime (number) - Customer maximum visit time duration\
 \+ UnitMaximumTime (number) - Unit maximum time\
 \+ cpfCnpj (string) - customer CPF/CNPJ\
 \+ groupsId (array\[number\]) - Array of groups id (must exist in auvo)\
 \+ managerTeamsId (array\[number\]) - Array of managers team id (must exist in auvo)\
 \+ managersId (array\[number\]) - Array of managers id (must exist in auvo)\
 \+ active (boolean) - Customer is active\
 \+ segmentId (number) - id of a registered segment (must exist in auvo)\
 \+ adressComplement (string) - Adress complement\
\
\+ Request (application/json)\
\
 \+ Headers\
\
 Authorization: Bearer token\
\
 \+ Body\
\
 \[\
 { "op": "replace", "path": "description", "value": "description value" }\
 \]\
\
 \+ Schema\
\
 {\
 "id": number,\
 "externalId": string,\
 "name": string,\
 "cpfCnpj":string,\
 "phoneNumber": \[string\],\
 "email": \[string\],\
 "manager": string,\
 "managerJobPosition": string,\
 "note": string,\
 "address": string,\
 "latitude": number,\
 "longitude": number,\
 "maximumVisitTime": number,\
 "unitMaximumTime": number,\
 "groupsId": \[number\],\
 "managerTeamsId": \[number\],\
 "managersId": \[number\],\
 "segmentId": number,\
 "active": ?boolean,\
 "adressComplement": string\
 }\
\
\+ Response 200 (application/json)\
\
 \+ Body\
\
 "result":{\
 "id": 42,\
 "externalId": "906",\
 "name": "Terêscio",\
 "cpfCnpj": "90614997000162",\
 "phoneNumber": \["5566123123"\],\
 "email": \["terenscio@customer.com"\],\
 "manager": "Oristides",\
 "managerJobPosition": "Manager",\
 "note": "nothing to say",\
 "address": "lake yululu",\
 "latitude": -16.6872086111083,\
 "longitude": -49.2995542287827,\
 "maximumVisitTime": 1,\
 "unitMaximumTime": 1,\
 "groupsId": \[0\],\
 "managerTeamsId": \[0\],\
 "managersId": \[0\],\
 "segmentId": 1,\
 "active": false,\
 "AdressComplement": "adress complement",\
 "creationDate": "2019-04-15T15:00:00",\
 "dateLastUpdate": "2019-04-15T15:00:00"\
 }\
\
\### Edit Customer attachment \[PUT /customer/{id}/attachments\]\
To update a \`Customer\` attachment, send a JSON with updated value to the \`Customer\` id.\
\
\+ Attributes\
 \+ removeAllAttachmentsInsertedByMe (boolean) - this option will remove all the previous attachments inserted for the Customer\
 \+ attachments (array\[object\])\
 \+ name(required, string) - the name MUST contain the file type (Ex. "my\_file.pdf")\
 \+ file(required, string) - base 64 file. )Ex: "/9j/4QqeRXhpZgAATU0AKgAAAAgABwESAAMAAAAB........")\
\
\+ Request (application/json)\
 \+ Headers\
\
 Authorization: Bearer token\
\
 \+ Body\
\
 {\
 "removeAllAttachmentsInsertedByMe": false,\
 "attachments": \[\
 {\
 "name": "my\_file.pdf",\
 "file": "base64 encoded file"\
 }\
 \]\
 }\
\
 \+ Schema\
\
 {\
 "removeAllAttachmentsInsertedByMe": boolean,\
 "attachments": array\
 }\
\
\+ Response 200 (application/json)\
\
 \+ Body\
\
 "result":{\
 "id": 42,\
 "externalId": "906",\
 "name": "Terêscio",\
 "cpfCnpj": "90614997000162",\
 "phoneNumber": \["5566123123"\],\
 "email": \["terenscio@customer.com"\],\
 "manager": "Oristides",\
 "managerJobPosition": "Manager",\
 "note": "nothing to say",\
 "address": "lake yululu",\
 "latitude": -16.6872086111083,\
 "longitude": -49.2995542287827,\
 "maximumVisitTime": 1,\
 "unitMaximumTime": 1,\
 "groupsId": \[0\],\
 "managerTeamsId": \[0\],\
 "managersId": \[0\],\
 "segmentId": 1,\
 "active": false,\
 "AdressComplement": "adress complemente",\
 "creationDate": "2019-04-15T15:00:00",\
 "dateLastUpdate": "2019-04-15T15:00:00",\
 "uriAnexos": \["https://auvo-producao.s3.amazonaws.com/anexos\_clientes/12d53e24-9e5a-4319-a070-458e18260321.jpeg"\]\
 }\
\
\
\### Delete a Customer \[DELETE /customers/{id}\]\
\+ Request (application/json)\
\
 \+ Headers\
\
 Authorization: Bearer token\
\
\+ Response 204\
\
\
\### Retrieves a list of Customers \[GET/customers/?paramFilter={paramFilter}&page={page}&pageSize={pageSize}&order={order}&selectfields={selectfields}\]\
\
\+ Parameters\
 \+ paramFilter (optional, string) ... paramFilter must be json encoded string.\
 \+ id (number) - The customer id\
 \+ description (string) - The customer name\
 \+ segmentId (number) - The segmentId id\
 \+ creationDate (string) - Customer creation date, filter date ("yyyy-MM-ddTHH:mm:ss").\
 \+ dateLastUpdate (string) - The last update date of the customer, filter date ("yyyy-MM-ddTHH:mm:ss")\
 \+ groupId (number) - The group id\
 \+ active (?boolean) - The customer status\
 \+ externalId (string) - Customer external ids. Allow multiples, separated by comma\
 \+ page (int) ... Page of the selection. Default 1.\
 \+ pageSize (int) ... Amount of records of the selection. Default 10.\
 \+ order (string) ... "asc"/0 for Ascending or "desc"/1 for Descending. Default "asc".\
 \+ selectfields (optional, string) ... For all fields, use empty string. To select fields, use the properties of the returned object separated by commas.\
\
\+ Request (application/json)\
\
 \+ Headers\
\
 Authorization: Bearer token\
\
\+ Response 200 (application/json)\
\
 \+ Body\
\
 "result": {\
 "entityList":\[\
 {\
 "id": 42,\
 "externalId": "906",\
 "description": "Terêscio",\
 "cpfCnpj": "90614997000162",\
 "phoneNumber": \["5566123123"\],\
 "email": \["terenscio@customer.com"\],\
 "manager": "Oristides",\
 "managerJobPosition": "Manager",\
 "note": "nothing to say",\
 "address": "lake yululu",\
 "latitude": -16.6872086111083,\
 "longitude": -49.2995542287827,\
 "maximumVisitTime": 1,\
 "unitMaximumTime": 1,\
 "groupsId": \[0\],\
 "managerTeamsId": \[0\],\
 "managersId": \[0\],\
 "segmentId": 1,\
 "active": false,\
 "adressComplement": "adress complemente",\
 "creationDate": "2019-04-15T15:00:00",\
 "dateLastUpdate": "2019-04-15T15:00:00",\
 "contacts": \[\
 {\
 "id": 23377,\
 "name": "contact.name",\
 "email": "contact.email@gmail.com",\
 "jobPosition": "",\
 "phone": ""\
 },\
 {\
 "id": 23378,\
 "name": "contact.name.2",\
 "email": "contact.email.2@hotmail.com",\
 "jobPosition": "manager",\
 "phone": ""\
 },\
 {\
 "id": 23379,\
 "name": "contact.name.3",\
 "email": "contact.email.3@hotmail.com",\
 "jobPosition": "",\
 "phone": ""\
 }\
 \],\
 "uriAnexos": \["https://auvo-producao.s3.amazonaws.com/anexos\_clientes/12d53e24-9e5a-4319-a070-458e18260321.jpeg"\]\
 }\
 \],\
 "pagedSearchReturnData": {\
 "order": 0,\
 "pageSize": 10,\
 "page": 1,\
 "totalItems": 2\
 },\
 "links": \[\
 {\
 "href": "https://api.auvo.com.br/v2/Customers/?Page=1&PageSize=10&Order=Asc",\
 "rel": "self",\
 "method": "GET"\
 },\
 {\
 "href": "https://api.auvo.com.br/v2/Customers/?Page=2&PageSize=10&Order=Asc",\
 "rel": "nextPage",\
 "method": "GET"\
 }\
 \]\
 }\
\
\
\# Group Customer groups\
\
\## Customer group \[/customerGroups/?paramFilter={paramFilter}\]\
\
\+ Parameters\
 \+ paramFilter (optional, string) ... paramFilter must be json encoded string.\
 \+ id (number) - The customer id\
 \+ description (string) - The user description\
\
\
\+ Model\
\
 \+ Body\
\
 "result": {\
 "entityList":\[\
 {\
 "id": 42,\
 "description": "Terêscio"\
 }\
 \]\
 }\
\
\
\### Retrieve a list of Customers group \[GET/customerGroups/?paramFilter={paramFilter}\]\
\
\+ Request (application/json)\
\
 \+ Headers\
\
 Authorization: Bearer token\
\
\+ Response 200 (application/json)\
\
 \[Customer group\]\[\]\
\
\+ Response 400 (application/json)\
\
 When making a request with invalid options, status code 400 will be returned. For example, passing an invalid \`id\` parameter.\
\
 \+ Body\
\
 {\
 "id": \[\
 "The value 'x' is not valid."\
 \]\
 }\
\
\+ Response 404\
\
 When the resource with the specified id does not exist.\
\
\
\### Add a new Customer group \[POST /customerGroups/\]\
\
The body example describes the minimum required attributes to successfully add a customer group. See the \*\*Atributes\*\* or \*\*Json Schema\*\* in the Example section for all allowed attributes.\
\
\+ Attributes\
 \+ description (required, string) - customer group description\
 \+ clientsId (optional, array\[number\]) - Array of customers id (must exist in auvo)\
\
\+ Request (application/json)\
\
 \+ Headers\
\
 Authorization: Bearer token\
\
 \+ Body\
\
 {\
 "description": "Terêscio",\
 "clientsId": \[1,2,3\]\
 }\
\
 \+ Schema\
\
 {\
 "description": string,\
 "clientsId": \[number\]\
 }\
\
\+ Response 201 (application/json)\
\
 \+ Body\
\
 "result":{\
 "id": 123,\
 "description": "Terêscio"\
 }\
\
\### Delete a Customer group \[DELETE /customerGroups/{id}\]\
\+ Request (application/json)\
\
 \+ Headers\
\
 Authorization: Bearer token\
\
\+ Response 204\
\
\
\### Retrieves a list of clients of the customer group \[GET/customerGroups/{clientGroupId}/clients/\]\
\
\+ Parameters\
\
 \+ clientGroupId (number) ... \`clientGroupId\` attribute of the \`CustomerGroup\`.\
\
\+ Request (application/json)\
\
 \+ Headers\
\
 Authorization: Bearer token\
\
\+ Response 200 (application/json)\
\
 \+ Body\
\
 "result": {\
 "entityList":\[\
 {\
 "id": 42,\
 "externalId": "906",\
 "description": "Terêscio",\
 "cpfCnpj": "90614997000162",\
 "phoneNumber": \["5566123123"\],\
 "email": \["terenscio@customer.com"\],\
 "manager": "Oristides",\
 "managerJobPosition": "Manager",\
 "note": "nothing to say",\
 "address": "lake yululu",\
 "latitude": -16.6872086111083,\
 "longitude": -49.2995542287827,\
 "maximumVisitTime": 1,\
 "unitMaximumTime": 1,\
 "groupsId": \[0\],\
 "managerTeamsId": \[0\],\
 "managersId": \[0\],\
 "segmentId": 1,\
 "active": false,\
 "AdressComplement": "adress complemente"\
 }\
 \]\
 }\
\
\# Group Teams\
\
\## Team \[/teams/{id}\]\
\
\+ Parameters\
\
 \+ id (number) ... \`id\` attribute of the \`Team\`.\
\
\+ Model\
\
 \+ Body\
\
 "result": {\
 "teamUsers": \[\
 "User1",\
 "User2"\
 \],\
 "teamManagers": \[\
 "Manager1",\
 "Manager2"\
 \],\
 "id": 4168,\
 "description": "Example of a description from a team"\
 }\
\
\
\
\## Retrieve a Team \[GET/teams/{id}\]\
\
\+ Request (application/json)\
\
 \+ Headers\
\
 Authorization: Bearer token\
\
\+ Response 200 (application/json)\
\
 \[Team\]\[\]\
\
\+ Response 400 (application/json)\
\
 When making a request with invalid options, status code 400 will be returned. For example, passing an invalid \`id\` parameter.\
\
 \+ Body\
\
 {\
 "id": \[\
 "The value 'x' is not valid."\
 \]\
 }\
\
\+ Response 404\
\
 When the resource with the specified id does not exist.\
\
\
\### Add a new Team \[POST/teams/\]\
\
The body example describes the minimum required attributes to successfully add a Team. See the \*\*Atributes\*\* or \*\*Json Schema\*\* in the Example section for all allowed attributes.\
\
\+ Attributes\
 \+ description (required, string) - team description\
 \+ participants (required, array\[number\]) - user's id who will be part of the team\
 \+ manangers (required, array\[number\]) - manager's id who will manage the team\
\
\
\
\+ Request (application/json)\
\
 \+ Headers\
\
 Authorization: Bearer token\
\
 \+ Body\
\
 {\
 "description": ""some description here,\
 "participants": \[\
 111,\
 222,\
 333\
 \],\
 "managers": \[\
 444,\
 555\
 \]\
 }\
 }\
\
 \+ Schema\
\
 {\
 "description": string,\
 "participants": \[number\],\
 "managers": \[number\]\
\
 }\
 }\
\
\+ Response 201 (application/json)\
\
 \+ Body\
\
 "result": {\
 "teamUsers": \[\
 "User1",\
 "User2",\
 "User3"\
 \],\
 "teamManagers": \[\
 "Manager1",\
 "Manager2"\
 \],\
 "id": 4000,\
 "description": "some description here"\
 }\
\
\
\
\## Retrieve a list of Teams \[GET/teams/?paramFilter={paramFilter}&page={page}&pageSize={pageSize}&order={order}\]\
\
\+ Parameters\
 \+ paramFilter (string) ... paramFilter must be a json encoded string.\
 \+ id (number) - The team id.\
 \+ description (string) - The team description.\
 \+ page (int) - Page of the selection. Default 1.\
 \+ pageSize (int) - Amount of records of the selection. Default 10.\
 \+ order (string) - "asc"/0 for Ascending or "desc"/1 for Descending. Default "asc".\
\
\+ Request (application/json)\
\
 \+ Headers\
\
 Authorization: Bearer token\
\
\+ Response 200 (application/json)\
\
 "result": {\
\
 "entityList": \[\
 {\
 "creationDate": "2018-02-19T10:11:57",\
 "teamUsers": \[\
 "User1",\
 "User2"\
 \],\
 "teamManagers": \[\
 "Manager1",\
 "Manager2"\
 \],\
 "id": 4562,\
 "description": "Example"\
 },\
 {\
 "creationDate": "2019-02-19T10:11:57",\
 "teamUsers": \[\
 "User1",\
 "User2"\
 \],\
 "teamManagers": \[\
 "Manager1",\
 "Manager2"\
 \],\
 "id": 4562,\
 "description": "Example of a simple description about teams"\
 }\
 \],\
 "pagedSearchReturnData": {\
 "order": 0,\
 "pageSize": 10,\
 "page": 1,\
 "totalItems": 2\
\
 },\
 "links": \[\
 {\
 "href": "https://api.auvo.com.br/v2/Teams/?Page=1&PageSize=10&Order=Asc",\
 "rel": "self",\
 "method": "GET"\
 }\
 \]\
 }\
\
\## Retrieve a list of participants from a specific team \[GET/teams/{teamId}/users/?page={page}&pageSize={pageSize}&order={order}\]\
\
\+ Parameters\
 \+ teamId (number) ... The team id.\
 \+ page (int) ... Page of the selection. Default 1.\
 \+ pageSize (int) ... Amount of records of the selection. Default 10.\
 \+ order (string) ... "asc"/0 for Ascending or "desc"/1 for Descending. Default "asc".\
\
\
\+ Request (application/json)\
\
 \+ Headers\
\
 Authorization: Bearer token\
\
\+ Response 200 (application/json)\
\
 \+ Body\
\
 "result": {\
 "entityList": \[\
 {\
 "userId": 52205,\
 "externalId": "",\
 "name": "User1",\
 "jobPosition": "description"\
 },\
 {\
 "userId": 52204,\
 "externalId": "",\
 "name": "User1",\
 "jobPosition": "description"\
 },\
 {\
 "userId": 52203,\
 "externalId": "",\
 "name": "User1",\
 "jobPosition": "description"\
 }\
 \],\
 "pagedSearchReturnData": {\
 "order": 0,\
 "pageSize": 10,\
 "page": 1,\
 "totalItems": 3\
 },\
 "links": \[\
 {\
 "href": "https://api.auvo.com.br/v2/Teams?ParamFilter=4168&Page=1&PageSize=10&Order=Asc",\
 "rel": "self",\
 "method": "GET"\
 }\
 \]\
 }\
\
\
\
\# Group Task types\
\
\## Task type \[/taskTypes/{id}\]\
\
\+ Parameters\
\
 \+ id (number) ... \`id\` attribute of the \`Task type\`.\
\
\+ Model\
\
 \+ Body\
\
 "result":{\
 "id": 42,\
 "description": "Terêscio",\
 "creatorId": 906,\
 "creationDate": "2016-03-23T18:10:00",\
 "standardTime": "18:10:00",\
 "toleranceTime": "18:10:00",\
 "standardQuestionnaireId": 1,\
 "active": true,\
 "sendSatisfactionSurvey": false,\
 "requirements": {\
 "fillReport": true,\
 "getSignature": false,\
 "fillRolledKilometer": true,\
 "emailTheTask": false,\
 "minimumNumberOfPhotos": 2,\
 "requiredQuestionnaires":\[\
 1,2,3\
 \]\
 }\
 }\
\
\### Retrieve a task type \[GET/taskTypes/{id}\]\
\
\+ Request (application/json)\
\
 \+ Headers\
\
 Authorization: Bearer token\
\
\+ Response 200 (application/json)\
\
 \[Task type\]\[\]\
\
\+ Response 400 (application/json)\
\
 When making a request with invalid options, status code 400 will be returned. For example, passing an invalid \`id\` parameter.\
\
 \+ Body\
\
 {\
 "id": \[\
 "The value 'x' is not valid."\
 \]\
 }\
\
\+ Response 404\
\
 When the resource with the specified id does not exist.\
\
\
\### Add a new Task type \[POST /taskTypes/\]\
\
The body example describes the minimum required attributes to successfully add a task type. See the \*\*Atributes\*\* or \*\*Json Schema\*\* in the Example section for all allowed attributes.\
\
\+ Attributes\
 \+ description (required, string) - task type description\
 \+ standartQuestionnaireId (number) - standard questionnaire id. Nullable\
 \+ standartTime (string) - standard time "hh:mm:ss"\
 \+ sendSatisfactionSurvey (boolean) - send satisfaction survey. Nullable\
 \+ requirements (object) - task type requirements\
 \+ fillReport (boolean) - fill report\
 \+ getSignature (boolean) - get signature\
 \+ fillRolledKilometer (boolean) - fill rolled kilometer\
 \+ emailTheTask (boolean) - email the task\
 \+ minimumNumberOfPhotos (number) - minimum number of photos. Nullable\
 \+ requiredQuestionnaires (array\[number\]) - required questionnaires id\
\
\
\+ Request (application/json)\
\
 \+ Headers\
\
 Authorization: Bearer token\
\
 \+ Body\
\
 {\
 "description": ""some description here,\
 "standartQuestionnaireId": 123,\
 "standartTime": "12:00:00",\
 "sendSatisfactionSurvey": false,\
 "requirements": {\
 "fillReport": true,\
 "getSignature": false,\
 "fillRolledKilometer": true,\
 "emailTheTask": false,\
 "minimumNumberOfPhotos": 1,\
 "requiredQuestionnaires": \[1,2,3\]\
 }\
 }\
\
 \+ Schema\
\
 {\
 "description": string,\
 "standartQuestionnaireId": ?number,\
 "standartTime": string,\
 "sendSatisfactionSurvey": ?boolean,\
 "requirements": {\
 "fillReport": boolean,\
 "getSignature": boolean,\
 "fillRolledKilometer": boolean,\
 "emailTheTask": boolean,\
 "minimumNumberOfPhotos": ?number,\
 "requiredQuestionnaires": \[number\]\
 }\
 }\
\
\+ Response 201 (application/json)\
\
 \+ Body\
\
 "result":{\
 "description": ""some description here,\
 "id": 12,\
 "creatorId": 123,\
 "creationDate": "2016-03-23T18:10:00",\
 "standar