"use strict";

// -------------------------------------------------------------------------- \\
// File: DateJSON.js                                                          \\
// Module: API                                                                \\
// -------------------------------------------------------------------------- \\

'use strict';

( function () {

const toJSON = function ( date ) {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const hour = date.getUTCHours();
    const minute = date.getUTCMinutes();
    const second = date.getUTCSeconds();

    return date ? (
        ( year < 1000 ?
            '0' + ( year < 100 ? '0' + ( year < 10 ? '0' : '' ) : '' ) + year :
            '' + year ) + '-' +
        ( month < 10 ? '0' + month : '' + month ) + '-' +
        ( day < 10 ? '0' + day : '' + day ) + 'T' +
        ( hour < 10 ? '0' + hour : '' + hour ) + ':' +
        ( minute < 10 ? '0' + minute : '' + minute ) + ':' +
        ( second < 10 ? '0' + second : '' + second )
    ) : null;
};

const toUTCJSON = function ( date ) {
    return date ? toJSON( date ) + 'Z' : null;
};

const toTimezoneOffsetJSON = function ( date ) {
    var offset = date.getTimezoneOffset();
    return date ? offset ?
        toJSON( new Date( date ).add( -offset, 'minute' ) ) +
            date.format( '%z' ) :
        toUTCJSON( date ) :
        null;
};

// --- Export

Date.prototype.toJSON = function () {
    return toJSON( this );
};

Date.toUTCJSON = toUTCJSON;
Date.toTimezoneOffsetJSON = toTimezoneOffsetJSON;

}() );


// -------------------------------------------------------------------------- \\
// File: namespace.js                                                         \\
// Module: API                                                                \\
// -------------------------------------------------------------------------- \\

'use strict';

this.JMAP = {};


// -------------------------------------------------------------------------- \\
// File: Auth.js                                                              \\
// Module: API                                                                \\
// Requires: namespace.js                                                     \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Obj = O.Object;
const HttpRequest = O.HttpRequest;
const RunLoop = O.RunLoop;

// ---

const MAIL_DATA = 'urn:ietf:params:jmap:mail';
const SUBMISSION_DATA = 'urn:ietf:params:jmap:submission';
const CONTACTS_DATA = 'urn:ietf:params:jmap:contacts';
const CALENDARS_DATA = 'urn:ietf:params:jmap:calendars';

const auth = new Obj({

    isAuthenticated: false,

    username: '',

    accounts: null,
    primaryAccounts: {},
    capabilities: {
        'urn:ietf:params:jmap:core': {
            maxSizeUpload: 50000000,
            maxConcurrentUpload: 10,
            maxSizeRequest: 5000000,
            maxConcurrentRequests: 8,
            maxCallsInRequest: 64,
            maxObjectsInGet: 1024,
            maxObjectsInSet: 1024,
            collationAlgorithms: [
                'i;ascii-numeric',
                'i;ascii-casemap',
            ],
        },
    },
    state: '',

    apiUrl: '',
    downloadUrl: '',
    uploadUrl: '',
    eventSourceUrl: '',

    MAIL_DATA: MAIL_DATA,
    SUBMISSION_DATA: SUBMISSION_DATA,
    CONTACTS_DATA: CONTACTS_DATA,
    CALENDARS_DATA: CALENDARS_DATA,

    getAccountId: function ( isPrimary, dataGroup ) {
        var primaryAccountId = this.get( 'primaryAccounts' )[ dataGroup ];
        if ( isPrimary ) {
            return primaryAccountId || null;
        }
        var accounts = this.get( 'accounts' );
        var id;
        for ( id in accounts ) {
            if ( id !== primaryAccountId &&
                    accounts[ id ].accountCapabilities[ dataGroup ] ) {
                return id;
            }
        }
        return null;
    },

    // ---

    didAuthenticate: function ( data ) {
        // This beginPropertyChanges is functional, as updateAccounts in
        // connections.js needs both accounts and primaryAccounts to be set,
        // but only observes accounts—so we must ensure primaryAccounts is set.
        this.beginPropertyChanges();
        for ( var property in data ) {
            if ( typeof this[ property ] !== 'function' ) {
                this.set( property, data[ property ] );
            }
        }
        this.set( 'isAuthenticated', true );
        this.endPropertyChanges();

        this._awaitingAuthentication.forEach( function ( connection ) {
            connection.send();
        });
        this._awaitingAuthentication.length = 0;

        return this;
    },

    didLoseAuthentication: function () {
        return this.set( 'isAuthenticated', false );
    },

    // ---

    isDisconnected: false,
    timeToReconnect: 0,

    _isFetchingSession: false,
    _awaitingAuthentication: [],
    _failedConnections: [],

    _timeToWait: 1,
    _timer: null,

    fetchSession: function ( authenticationUrl, accessToken ) {
        if ( this._isFetchingSession ) {
            return this;
        }
        this._isFetchingSession = true;

        if ( !authenticationUrl ) {
            authenticationUrl = this.get( 'authenticationUrl' );
        }
        if ( !accessToken ) {
            accessToken = this.get( 'accessToken' );
        }

        new HttpRequest({
            method: 'GET',
            url: authenticationUrl,
            headers: {
                'Accept': 'application/json',
                'Authorization': accessToken,
            },
            timeout: 45000,
            responseType: 'json',

            onSuccess: function ( event ) {
                auth.set( 'authenticationUrl', authenticationUrl )
                    .set( 'accessToken', accessToken )
                    .didAuthenticate( event.data );
            }.on( 'io:success' ),
        }).send();

        return this;
    },

    connectionWillSend: function ( connection ) {
        var isAuthenticated = this.get( 'isAuthenticated' );
        if ( isAuthenticated &&
                !this._failedConnections.contains( connection ) ) {
            return true;
        }
        if ( !isAuthenticated || this._isFetchingSession ) {
            this._awaitingAuthentication.include( connection );
        }
        return false;
    },

    connectionSucceeded: function () {
        if ( this.get( 'isDisconnected' ) ) {
            this._timeToWait = 1;
            this.set( 'isDisconnected', false );
        }
    },

    connectionFailed: function ( connection, timeToWait ) {
        if ( this.get( 'isAuthenticated' ) ) {
            this._failedConnections.include( connection );
            this.retryIn( timeToWait );
        } else {
            this._awaitingAuthentication.include( connection );
        }
    },

    retryIn: function ( timeToWait ) {
        // If we're not already ticking down...
        if ( !this._timer ) {
            if ( !timeToWait ) {
                timeToWait = this._timeToWait;
            }
            this.set( 'isDisconnected', true )
                .set( 'timeToReconnect', timeToWait );
            this._timer = RunLoop.invokePeriodically( this._tick, 1000, this );
        }
    },

    _tick: function () {
        var timeToReconnect = this.get( 'timeToReconnect' ) - 1;
        this.set( 'timeToReconnect', timeToReconnect );
        if ( !timeToReconnect ) {
            this.retryConnections( true );
        }
    },

    retryConnections: function ( backoffOnFail ) {
        var failedConnections = this._failedConnections;
        RunLoop.cancel( this._timer );
        this.set( 'timeToReconnect', 0 );
        this._timer = null;
        this._failedConnections = [];
        if ( backoffOnFail ) {
            this._timeToWait = Math.min( this._timeToWait * 2, 300 );
        }
        failedConnections.forEach( function ( connection ) {
            connection.send();
        });
    }
});

// --- Export

JMAP.auth = auth;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Connection.js                                                        \\
// Module: API                                                                \\
// Requires: Auth.js                                                          \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP, console, alert */

'use strict';

( function ( JMAP, undefined ) {

const isEqual = O.isEqual;
const loc = O.loc;
const guid = O.guid;
const Class = O.Class;
const RunLoop = O.RunLoop;
const HttpRequest = O.HttpRequest;
const Source = O.Source;
const LOADING = O.Status.LOADING;

const auth = JMAP.auth;

// ---

const serverUnavailable = function ( methodResponse ) {
    return methodResponse[0] === 'error' &&
        methodResponse[1].type === 'serverUnavailable';
};

const applyPatch = function ( object, path, patch ) {
    var slash, key;
    while ( true ) {
        // Invalid patch; path does not exist
        if ( !object ) {
            return;
        }
        slash = path.indexOf( '/' );
        if ( slash > -1 ) {
            key = path.slice( 0, slash );
            path = path.slice( slash + 1 );
        } else {
            key = path;
        }
        key = key.replace( /~1/g, '/' ).replace( /~0/g, '~' );
        if ( slash > -1 ) {
            object = object[ key ];
        } else {
            if ( patch !== null ) {
                object[ key ] = patch;
            } else {
                delete object[ key ];
            }
            break;
        }
    }
};

const makePatches = function ( path, patches, original, current, mayPatch ) {
    var key;
    var didPatch = false;
    if ( original && current &&
            typeof current === 'object' && !( current instanceof Array ) &&
            ( !mayPatch || mayPatch( path, original, current ) ) ) {
        for ( key in current ) {
            didPatch = makePatches(
                path + '/' + key.replace( /~/g, '~0' ).replace( /\//g, '~1' ),
                patches,
                original[ key ],
                current[ key ],
                mayPatch
            ) || didPatch;
        }
        for ( key in original ) {
            if ( !( key in current ) ) {
                didPatch = makePatches(
                    path + '/' +
                        key.replace( /~/g, '~0' ).replace( /\//g, '~1' ),
                    patches,
                    original[ key ],
                    null,
                    mayPatch
                ) || didPatch;
            }
        }
    } else if ( !isEqual( original, current ) ) {
        patches[ path ] = current !== undefined ? current : null;
        didPatch = true;
    }
    return didPatch;
};

const makeUpdate = function ( primaryKey, update, mayPatch, isCopy ) {
    const storeKeys = update.storeKeys;
    const records = update.records;
    const changes = update.changes;
    const committed = update.committed;
    const copyFromIds = update.copyFromIds;
    const updates = {};
    var record, change, previous, patches, i, l, key;
    for ( i = 0, l = records.length; i < l; i +=1 ) {
        record = records[i];
        change = changes[i];
        previous = mayPatch ? committed[i] : null;
        patches = {};

        for ( key in change ) {
            if ( change[ key ] && key !== 'accountId' ) {
                if ( mayPatch ) {
                    makePatches(
                        key, patches, previous[ key ], record[ key ],
                        typeof mayPatch === 'function' ? mayPatch : null,
                    );
                } else {
                    patches[ key ] = record[ key ];
                }
            }
        }
        if ( isCopy ) {
            patches[ primaryKey ] = copyFromIds[i];
        }

        updates[ isCopy ? storeKeys[i] : record[ primaryKey ] ] = patches;
    }
    return Object.keys( updates ).length ? updates : undefined;
};

const makeSetRequest = function ( change, mayPatch ) {
    var create = change.create;
    var update = change.update;
    var destroy = change.destroy;
    var toCreate = create.storeKeys.length ?
        Object.zip( create.storeKeys, create.records ) :
        undefined;
    var toUpdate = makeUpdate( change.primaryKey, update, mayPatch, false );
    var toDestroy = destroy.ids.length ?
        destroy.ids :
        undefined;
    return toCreate || toUpdate || toDestroy ? {
        accountId: change.accountId,
        create: toCreate,
        update: toUpdate,
        destroy: toDestroy,
    } : null;
};

const hasResultReference = function ( methodCall ) {
    for ( var key in methodCall[1] ) {
        if ( key.charAt( 0 ) === '#' ) {
            return true;
        }
    }
    return false;
};

const handleProps = {
    precedence: 'commitPrecedence',
    fetch: 'recordFetchers',
    refresh: 'recordRefreshers',
    commit: 'recordCommitters',
    query: 'queryFetchers',
};

const NO_RESPONSE = [ 'error', {}, '' ];

/**
    Class: JMAP.Connection

    Extends: O.Source

    An Connection communicates with a server using a JSON protocol conformant
    with the [JMAP](http://jmap.io) standard, allowing multiple fetches and
    commits to be batched into a single HTTP request for efficiency, with
    requests for the same type of object grouped together.

    A request consists of a JSON array, with each element in the array being
    itself an array of three elements, the first a method name, the second an
    object consisting of named arguments, and the third a tag used to associate
    the request with the response:

        [
            [ 'method', {
                arg1: 'foo',
                arg2: 'bar'
            }, '#1' ],
            [ 'method2', {
                foo: [ 'an', 'array' ],
                bar: 42
            }, '#2' ]
        ]

    The response is expected to be in the same format, with methods from
    <JMAP.Connection#response> available to the server to call.
*/
const Connection = Class({

    Extends: Source,

    /**
        Constructor: JMAP.Connection

        Parameters:
            mixin - {Object} (optional) Any properties in this object will be
                    added to the new O.Object instance before initialisation (so
                    you can pass it getter/setter functions or observing
                    methods). If you don't specify this, your source isn't going
                    to do much!
    */
    init: function ( mixin ) {
        // List of method/args queued for sending in the next request.
        this._sendQueue = [];
        // List of callback functions to be executed after the next request.
        this._callbackQueue = [];

        // Map of id -> O.Query for all queries to be fetched.
        this._queriesToFetch = {};
        // Map of accountId -> guid( Type ) -> state
        this._typesToRefresh = {};
        // Map of accountId -> guid( Type ) -> Id -> true
        this._recordsToRefresh = {};
        // Map of accountId -> guid( Type ) -> null
        this._typesToFetch = {};
        // Map of accountId -> guid( Type ) -> Id -> true
        this._recordsToFetch = {};
        // Map of guid( Type ) -> Type
        this._typeIdToType = {};

        // { createdIds: {...}, doneCount, sentCount }
        this._inFlightContext = null;

        this.inFlightRemoteCalls = null;
        this.inFlightCallbacks = null;
        this.inFlightRequest = null;

        Connection.parent.constructor.call( this, mixin );
    },

    prettyPrint: false,

    /**
        Property: JMAP.Connection#willRetry
        Type: Boolean

        If true, retry the request if the connection fails or times out.
    */
    willRetry: true,

    /**
        Property: JMAP.Connection#timeout
        Type: Number

        Time in milliseconds at which to time out the request. Set to 0 for no
        timeout.
    */
    timeout: 30000,

    /**
        Property: JMAP.Connection#timeout
        Type: Number

        Time in milliseconds at which to time out the request once it has
        finished uploading to the server; this is set higher than the initial
        timeout so if the OS is buffering the upload we don't timeout on slow
        connections.
    */
    timeoutAfterUpload: 120000,

    /**
        Property: JMAP.Connection#inFlightRequest
        Type: (O.HttpRequest|null)

        The HttpRequest currently in flight.
    */
    inFlightRequest: null,

    ioDidProgressUpload: function ( event ) {
        if ( event.loaded === event.total ) {
            this.get( 'inFlightRequest' )
                .set( 'timeout', this.get( 'timeoutAfterUpload' ) );
        }
    }.on( 'io:uploadProgress' ),

    /**
        Method: JMAP.Connection#ioDidSucceed

        Callback when the IO succeeds. Parses the JSON and passes it on to
        <JMAP.Connection#handleResponses>.

        Parameters:
            event - {IOEvent}
    */
    ioDidSucceed: function ( event ) {
        var data = event.data;
        var methodResponses = data && data.methodResponses;
        var sessionState = data && data.sessionState;
        var inFlightRemoteCalls = this.get( 'inFlightRemoteCalls' );
        if ( !methodResponses || methodResponses.some( serverUnavailable ) ) {
            // Successful response code but no method responses happens
            // occasionally; I don't know why, some kind of broken proxy
            // changing the status code perhaps? Treat as a connection failure.
            //
            // serverUnavailable error is a tricky one. Technically we should
            // just be retrying those method calls and not the whole lot but
            // this is easier to do for now and in practice it's very unusual
            // for one to return this error and not everything. Most requests
            // are idempotent too, so this behaviour is not ridiculous.
            if ( this.get( 'willRetry' ) ) {
                auth.connectionFailed( this );
                return;
            } else if ( !methodResponses ) {
                methodResponses = [];
            }
        }

        auth.connectionSucceeded( this );

        if ( sessionState && sessionState !== auth.get( 'state' ) ) {
            auth.fetchSession();
        }

        this.handleResponses(
            methodResponses,
            inFlightRemoteCalls,
            event
        );


        // Need to send the next page if there were too many method calls to
        // send at once.
        var inFlightContext = this._inFlightContext;
        if ( inFlightContext &&
                inFlightContext.doneCount + inFlightContext.sentCount <
                inFlightRemoteCalls.length ) {
            inFlightContext.doneCount += inFlightContext.sentCount;
            inFlightContext.createdIds = data.createdIds;
            return;
        }

        this.processCallbacks(
            this.get( 'inFlightCallbacks' ),
            methodResponses,
            inFlightRemoteCalls
        );

        this._inFlightContext = null;
        this.set( 'inFlightRemoteCalls', null )
            .set( 'inFlightCallbacks', null );
    }.on( 'io:success' ),

    /**
        Method: JMAP.Connection#ioDidFail

        Callback when the IO fails.

        Parameters:
            event - {IOEvent}
    */
    ioDidFail: function ( event ) {
        var discardRequest = false;
        var status = event.status;

        switch ( status ) {
        // 400: Bad Request
        // 413: Payload Too Large
        case 400:
        case 413:
            var response = event.data;
            RunLoop.didError({
                name: 'JMAP.Connection#ioDidFail',
                message: 'Bad request made: ' + status,
                details: 'Request was:\n' +
                    JSON.stringify(
                        this.get( 'inFlightRemoteCalls' ), null, 2 ) +
                    '\n\nResponse was:\n' +
                    ( response ? JSON.stringify( response, null, 2 ) :
                        '(no data, the response probably wasn’t valid JSON)' ),
            });
            discardRequest = true;
            break;
        // 401: Unauthorized
        case 401:
            auth.didLoseAuthentication()
                .connectionWillSend( this );
            break;
        // 404: Not Found
        case 404:
            auth.fetchSession()
                .connectionWillSend( this );
            break;
        // 429: Rate Limited
        // 502/503/504: Service Unavailable
        // Wait a bit then try again
        case 429:
        case 502: // Bad Gateway
        case 503: // Service Unavailable
        case 504: // Gateway Timeout
            auth.connectionFailed( this, 30 );
            break;
        // 500: Internal Server Error
        case 500:
            alert( loc( 'FEEDBACK_SERVER_FAILED' ) );
            discardRequest = true;
            break;
        // Presume a connection error. Try again if willRetry is set,
        // otherwise discard.
        default:
            if ( this.get( 'willRetry' ) ) {
                auth.connectionFailed( this );
            } else {
                discardRequest = true;
            }
        }

        if ( discardRequest ) {
            this.processCallbacks(
                this.get( 'inFlightCallbacks' ),
                [],
                this.get( 'inFlightRemoteCalls' )
            );

            this.set( 'inFlightRemoteCalls', null )
                .set( 'inFlightCallbacks', null );
        }
    }.on( 'io:failure', 'io:abort' ),

    /**
        Method: JMAP.Connection#ioDidEnd

        Callback when the IO ends.

        Parameters:
            event - {IOEvent}
    */
    ioDidEnd: function ( event ) {
        // Send any waiting requests
        this.set( 'inFlightRequest', null )
            .send();
        // Destroy old HttpRequest object.
        event.target.destroy();
    }.on( 'io:end' ),

    /**
        Method: JMAP.Connection#callMethod

        Add a method call to be sent on the next request and trigger a request
        to be sent at the end of the current run loop.

        Parameters:
            name     - {String} The name of the method to call.
            args     - {Object} The arguments for the method.
            callback - {Function} (optional) A callback to execute after the
                       request completes successfully.
    */
    callMethod: function ( name, args, callback ) {
        var id = this._sendQueue.length + '';
        this._sendQueue.push([ name, args || {}, id ]);
        if ( callback ) {
            this._callbackQueue.push([ id, callback ]);
        }
        this.send();
        return this;
    },

    getPreviousMethodId: function () {
        return ( this._sendQueue.length - 1 ) + '';
    },

    fetchType: function ( typeId, accountId, ids ) {
        this.callMethod( typeId + '/get', {
            accountId: accountId,
            ids: ids,
        });
    },

    refreshType: function ( typeId, accountId, ids, state ) {
        var get = typeId + '/get';
        if ( ids ) {
            this.callMethod( get, {
                accountId: accountId,
                ids: ids,
            });
        } else {
            var changes = typeId + '/changes';
            this.callMethod( changes, {
                accountId: accountId,
                sinceState: state,
                maxChanges: 100,
            });
            var methodId = this.getPreviousMethodId();
            this.callMethod( get, {
                accountId: accountId,
                '#ids': {
                    resultOf: methodId,
                    name: changes,
                    path: '/created',
                },
            });
            this.callMethod( get, {
                accountId: accountId,
                '#ids': {
                    resultOf: methodId,
                    name: changes,
                    path: '/updated',
                },
            });
        }
        return this;
    },

    commitType: function ( typeId, changes, mayPatch ) {
        var setRequest = makeSetRequest( changes, mayPatch );
        var moveFromAccount, fromAccountId, accountId;
        if ( setRequest ) {
            this.callMethod( typeId + '/set', setRequest );
        }
        if (( moveFromAccount = changes.moveFromAccount )) {
            accountId = changes.accountId;
            for ( fromAccountId in moveFromAccount ) {
                this.callMethod( typeId + '/copy', {
                    fromAccountId: fromAccountId,
                    accountId: accountId,
                    create: makeUpdate(
                        changes.primaryKey,
                        moveFromAccount[ fromAccountId ],
                        null,
                        true
                    ),
                    onSuccessDestroyOriginal: true,
                });
            }
        }
    },

    addCallback: function ( callback ) {
        this._callbackQueue.push([ '', callback ]);
        return this;
    },

    hasRequests: function () {
        var id;
        if ( this.get( 'inFlightRemoteCalls' ) || this._sendQueue.length ) {
            return true;
        }
        for ( id in this._queriesToFetch ) {
            return true;
        }
        for ( id in this._recordsToFetch ) {
            return true;
        }
        for ( id in this._recordsToRefresh ) {
            return true;
        }
        return false;
    },

    willSendRequest: function ( request/*, headers*/ ) {
        return JSON.stringify( request, null,
            this.get( 'prettyPrint' ) ? 2 : 0 );
    },

    headers: function () {
        return {
            'Content-type': 'application/json',
            'Accept': 'application/json',
            'Authorization': auth.get( 'accessToken' ),
        };
    }.property().nocache(),

    /**
        Method: JMAP.Connection#send

        Send any queued method calls at the end of the current run loop.
    */
    send: function () {
        if ( this.get( 'inFlightRequest' ) ||
                !auth.connectionWillSend( this ) ) {
            return;
        }

        var remoteCalls = this.get( 'inFlightRemoteCalls' );
        var request;
        if ( !remoteCalls ) {
            request = this.makeRequest();
            remoteCalls = request[0];
            if ( !remoteCalls.length ) {
                return;
            }
            this.set( 'inFlightRemoteCalls', remoteCalls );
            this.set( 'inFlightCallbacks', request[1] );
        }
        var headers = this.get( 'headers' );
        var capabilities = auth.get( 'capabilities' );
        var maxCallsInRequest =
            capabilities[ 'urn:ietf:params:jmap:core' ].maxCallsInRequest;
        var inFlightContext = this._inFlightContext;
        var createdIds = undefined;

        if ( !inFlightContext && remoteCalls.length > maxCallsInRequest ) {
            inFlightContext = {
                createdIds: {},
                doneCount: 0,
                sentCount: 0,
            };
            this._inFlightContext = inFlightContext;
        }
        if ( inFlightContext ) {
            var start = inFlightContext.doneCount;
            var end = start + maxCallsInRequest;
            if ( end < remoteCalls.length ) {
                while ( end > start + 1 ) {
                    // We presume any back references are always to the previous
                    // method call and never "jump". If we start doing something
                    // different we'll have to add more logic.
                    if ( !hasResultReference( remoteCalls[ end ] ) ) {
                        break;
                    }
                    end -= 1;
                }
            }
            remoteCalls = remoteCalls.slice( start, end );
            inFlightContext.sentCount = remoteCalls.length;
            createdIds = inFlightContext.createdIds;
        }

        this.set( 'inFlightRequest',
            new HttpRequest({
                nextEventTarget: this,
                timeout: this.get( 'timeout' ),
                method: 'POST',
                url: auth.get( 'apiUrl' ),
                headers: headers,
                withCredentials: false,
                responseType: 'json',
                data: this.willSendRequest({
                    using: Object.keys( capabilities ),
                    methodCalls: remoteCalls,
                    createdIds: createdIds,
                }, headers ),
            }).send()
        );
    }.queue( 'after' ),

    /**
        Method: JMAP.Connection#handleResponses

        After completing a request, this method is called to process the
        response returned by the server.

        Parameters:
            data        - {Array} The array of method calls to execute in
                          response to the request.
            remoteCalls - {Array} The array of method calls that was executed on
                          the server.
    */
    handleResponses: function ( data, remoteCalls/*, event*/ ) {
        var handlers = this.response;
        var i, l, response, handler, id, request;
        for ( i = 0, l = data.length; i < l; i += 1 ) {
            response = data[i];
            handler = handlers[ response[0] ];
            if ( handler ) {
                id = response[2];
                request = id && remoteCalls[+id] || null;
                try {
                    handler.call(
                        this,
                        response[1],
                        request ? request[0] : '',
                        request ? request[1] : {}
                    );
                } catch ( error ) {
                    RunLoop.didError( error );
                }
            }
        }
    },

    /**
        Method: JMAP.Connection#processCallbacks

        After completing a request, this method is called to process the
        callbackss

        Parameters:
            callbacks   - {Array} The array of callbacks.
            data        - {Array} The array of method call responses.
            remoteCalls - {Array} The array of method call requests
    */
    processCallbacks: function ( callbacks, methodResponses, methodCalls ) {
        var i, l, matchingResponse, id, request, response, tuple, callback;
        // Invoke after bindings to ensure all data has propagated through.
        if (( l = callbacks.length )) {
            matchingResponse = function ( call ) {
                return call[2] === id;
            };
            for ( i = 0; i < l; i += 1 ) {
                tuple = callbacks[i];
                id = tuple[0];
                callback = tuple[1];
                if ( id ) {
                    request = methodCalls[+id];
                    response =
                        methodResponses.find( matchingResponse ) ||
                        NO_RESPONSE;
                    callback = callback.bind( null,
                        response[1], response[0], request[1] );
                }
                RunLoop.queueFn( 'middle', callback );
            }
        }
    },

    /**
        Method: JMAP.Connection#makeRequest

        This will make calls to
        JMAP.Connection#(record|query)(Fetchers|Refreshers)
        to add any final API calls to the send queue, then return a tuple of the
        queue of method calls and the list of callbacks.

        Returns:
            {Array} Tuple of method calls and callbacks.
    */
    makeRequest: function () {
        var sendQueue = this._sendQueue;
        var callbacks = this._callbackQueue;
        var recordRefreshers = this.recordRefreshers;
        var recordFetchers = this.recordFetchers;
        var _queriesToFetch = this._queriesToFetch;
        var _typesToRefresh = this._typesToRefresh;
        var _recordsToRefresh = this._recordsToRefresh;
        var _typesToFetch = this._typesToFetch;
        var _recordsToFetch = this._recordsToFetch;
        var typesToRefresh, recordsToRefresh, typesToFetch, recordsToFetch;
        var accountId, typeId, id, req, state, ids, handler;

        // Query Fetches: do first, as it may trigger records to fetch/refresh
        this._queriesToFetch = {};
        for ( id in _queriesToFetch ) {
            req = _queriesToFetch[ id ];
            handler = this.queryFetchers[ guid( req.constructor ) ];
            if ( handler ) {
                handler.call( this, req );
            }
        }

        // Record Refreshers
        this._typesToRefresh = {};
        for ( accountId in _typesToRefresh ) {
            typesToRefresh = _typesToRefresh[ accountId ];
            if ( !accountId ) {
                accountId = undefined;
            }
            for ( typeId in typesToRefresh ) {
                state = typesToRefresh[ typeId ];
                handler = recordRefreshers[ typeId ];
                if ( typeof handler === 'string' ) {
                    this.refreshType( handler, accountId, null, state );
                } else {
                    handler.call( this, accountId, null, state );
                }
            }
        }

        this._recordsToRefresh = {};
        for ( accountId in _recordsToRefresh ) {
            recordsToRefresh = _recordsToRefresh[ accountId ];
            if ( !accountId ) {
                accountId = undefined;
            }
            for ( typeId in recordsToRefresh ) {
                handler = recordRefreshers[ typeId ];
                ids = Object.keys( recordsToRefresh[ typeId ] );
                if ( typeof handler === 'string' ) {
                    this.fetchType( handler, accountId, ids );
                } else {
                    handler.call( this, accountId, ids );
                }
            }
        }

        // Record fetches
        this._typesToFetch = {};
        for ( accountId in _typesToFetch ) {
            typesToFetch = _typesToFetch[ accountId ];
            if ( !accountId ) {
                accountId = undefined;
            }
            for ( typeId in typesToFetch ) {
                handler = recordFetchers[ typeId ];
                if ( typeof handler === 'string' ) {
                    this.fetchType( handler, accountId, null );
                } else {
                    handler.call( this, accountId, null );
                }
            }
        }

        this._recordsToFetch = {};
        for ( accountId in _recordsToFetch ) {
            recordsToFetch = _recordsToFetch[ accountId ];
            if ( !accountId ) {
                accountId = undefined;
            }
            for ( typeId in recordsToFetch ) {
                handler = recordFetchers[ typeId ];
                ids = Object.keys( recordsToFetch[ typeId ] );
                if ( typeof handler === 'string' ) {
                    this.fetchType( handler, accountId, ids );
                } else {
                    handler.call( this, accountId, ids );
                }
            }
        }

        // Any future requests will be added to a new queue.
        this._sendQueue = [];
        this._callbackQueue = [];

        return [ sendQueue, callbacks ];
    },

    // ---

    /**
        Method: JMAP.Connection#fetchRecord

        Fetches a particular record from the source. Just passes the call on to
        <JMAP.Connection#_fetchRecords>.

        Parameters:
            Type     - {O.Class} The record type.
            id       - {String} The record id.
            callback - {Function} (optional) A callback to make after the record
                       fetch completes (successfully or unsuccessfully).

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchRecord: function ( accountId, Type, id, callback ) {
        return this._fetchRecords(
            accountId, Type, [ id ], callback, '', false );
    },

    /**
        Method: JMAP.Connection#fetchAllRecords

        Fetches all records of a particular type from the source. Just passes
        the call on to <JMAP.Connection#_fetchRecords>.

        Parameters:
            Type     - {O.Class} The record type.
            state    - {(String|undefined)} The state to update from.
            callback - {Function} (optional) A callback to make after the fetch
                       completes.

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchAllRecords: function ( accountId, Type, state, callback ) {
        return this._fetchRecords(
            accountId, Type, null, callback, state || '', !!state );
    },

    /**
        Method: JMAP.Connection#refreshRecord

        Fetches any new data for a record since the last fetch if a handler for
        the type is defined in <JMAP.Connection#recordRefreshers>, or refetches
        the whole record if not.

        Parameters:
            Type     - {O.Class} The record type.
            id       - {String} The record id.
            callback - {Function} (optional) A callback to make after the record
                       refresh completes (successfully or unsuccessfully).

        Returns:
            {Boolean} Returns true if the source handled the refresh.
    */
    refreshRecord: function ( accountId, Type, id, callback ) {
        return this._fetchRecords(
            accountId, Type, [ id ], callback, '', true );
    },

    _fetchRecords: function ( accountId, Type, ids, callback, state, refresh ) {
        var typeId = guid( Type );
        var handler = refresh ?
                this.recordRefreshers[ typeId ] :
                this.recordFetchers[ typeId ];
        if ( refresh && !handler ) {
            refresh = false;
            handler = this.recordFetchers[ typeId ];
        }
        if ( !handler ) {
            return false;
        }
        if ( ids ) {
            var reqs = refresh ? this._recordsToRefresh : this._recordsToFetch;
            var account = reqs[ accountId ] || ( reqs[ accountId ] = {} );
            var set = account[ typeId ] || ( account[ typeId ] = {} );
            var l = ids.length;
            while ( l-- ) {
                set[ ids[l] ] = true;
            }
        } else if ( refresh ) {
            var typesToRefresh = this._typesToRefresh[ accountId ] ||
                ( this._typesToRefresh[ accountId ] = {} );
            typesToRefresh[ typeId ] = state;
        } else {
            var typesToFetch = this._typesToFetch[ accountId ] ||
                ( this._typesToFetch[ accountId ] = {} );
            typesToFetch[ typeId ] = null;
        }
        if ( callback ) {
            this._callbackQueue.push([ '', callback ]);
        }
        this.send();
        return true;
    },

    /**
        Property: JMAP.Connection#commitPrecedence
        Type: String[Number]|null
        Default: null

        This is on optional mapping of type guids to a number indicating the
        order in which they are to be committed. Types with lower numbers will
        be committed first.
    */
    commitPrecedence: null,

    /**
        Method: JMAP.Connection#commitChanges

        Commits a set of creates/updates/destroys to the source. These are
        specified in a single object, which has record type guids as keys and an
        object with create/update/destroy properties as values. Those properties
        have the following types:

        create  - `[ [ storeKeys... ], [ dataHashes... ] ]`
        update  - `[ [ storeKeys... ], [ dataHashes... ], [changedMap... ] ]`
        destroy - `[ [ storeKeys... ], [ ids... ] ]`

        Each subarray inside the 'create' array should be of the same length,
        with the store key at position 0 in the first array, for example,
        corresponding to the data object at position 0 in the second. The same
        applies to the update and destroy arrays.

        A changedMap, is a map of attribute names to a boolean value indicating
        whether that value has actually changed. Any properties in the data
        which are not in the changed map are presumed unchanged.

        An example call might look like:

            source.commitChanges({
                id: {
                    Type: Record,
                    typeId: 'Record',
                    accountId: '...',
                    primaryKey: 'id',
                    create: {
                        storeKeys: [ 'sk1', 'sk2' ],
                        records: [{ attr: val, attr2: val2 ...}, {...}],
                    },
                    update: {
                        storeKeys: [ 'sk3', 'sk4', ... ],
                        records:   [{ id: 'id3', attr: val2 ... }, {...}],
                        committed:  [{ id: 'id3', attr: val1 ... }, {...}],
                        changes:   [{ attr: true }, ... ],
                    },
                    moveFromAccount: { ... previous account id -> update ... },
                    destroy: {
                        storeKeys: [ 'sk5', 'sk6' ],
                        ids: [ 'id5', 'id6' ],
                    },
                    state: 'i425m515233',
                },
                id2: {
                    ...
                },
            });

        In a JMAP source, this method considers each type in the changes.
        If that type has a handler defined in
        <JMAP.Connection#recordCommitters>, then this will be called with the
        create/update/destroy object as the sole argument.

        Parameters:
            changes  - {Object} The creates/updates/destroys to commit.
            callback - {Function} (optional) A callback to make after the
                       changes have been committed.

        Returns:
            {Boolean} Returns true if any of the types were handled. The
            callback will only be called if the source is handling at least one
            of the types being committed.
    */
    commitChanges: function ( changes, callback ) {
        var ids = Object.keys( changes );
        var l = ids.length;
        var precedence = this.commitPrecedence;
        var handledAny = false;
        var handler, change, id;

        if ( precedence ) {
            ids.sort( function ( a, b ) {
                return ( precedence[ changes[b].typeId ] || -1 ) -
                    ( precedence[ changes[a].typeId ] || -1 );
            });
        }

        while ( l-- ) {
            id = ids[l];
            change = changes[ id ];
            handler = this.recordCommitters[ change.typeId ];
            if ( handler ) {
                if ( typeof handler === 'string' ) {
                    this.commitType( handler, change, true );
                } else {
                    handler.call( this, change );
                }
                handledAny = true;
            }
        }
        if ( handledAny && callback ) {
            this._callbackQueue.push([ '', callback ]);
        }
        return handledAny;
    },

    /**
        Method: JMAP.Connection#fetchQuery

        Fetches the data for a remote query from the source.

        Parameters:
            query - {O.Query} The query to fetch.

        Returns:
            {Boolean} Returns true if the source handled the fetch.
    */
    fetchQuery: function ( query, callback ) {
        if ( !this.queryFetchers[ guid( query.constructor ) ] ) {
            return false;
        }
        var id = query.get( 'id' );

        this._queriesToFetch[ id ] = query;

        if ( callback ) {
            this._callbackQueue.push([ '', callback ]);
        }
        this.send();
        return true;
    },

    /**
        Method: JMAP.Connection#handle

        Helper method to register handlers for a particular type. The handler
        object may include methods with the following keys:

        - precedence: Add function to `commitPrecedence` handlers.
        - fetch: Add function to `recordFetchers` handlers.
        - refresh: Add function to `recordRefreshers` handlers.
        - commit: Add function to `recordCommitters` handlers.
        - query: Add function to `queryFetcher` handlers.

        Any other keys are presumed to be a response method name, and added
        to the `response object.

        Parameters:
            Type     - {O.Class} The type these handlers are for.
            handlers - {string[function]} The handlers. These are registered
                       as described above.

        Returns:
            {JMAP.Connection} Returns self.
    */
    handle: function ( Type, handlers ) {
        var typeId = guid( Type );
        var action, propName, isResponse, actionHandlers;
        for ( action in handlers ) {
            propName = handleProps[ action ];
            isResponse = !propName;
            if ( isResponse ) {
                propName = 'response';
            }
            actionHandlers = this[ propName ];
            if ( !this.hasOwnProperty( propName ) ) {
                this[ propName ] = actionHandlers =
                    Object.create( actionHandlers );
            }
            actionHandlers[ isResponse ? action : typeId ] = handlers[ action ];
        }
        if ( Type ) {
            Type.source = this;
            this._typeIdToType[ typeId ] = Type;
        }
        return this;
    },

    /**
        Property: JMAP.Connection#recordFetchers
        Type: String[Function]

        A map of type guids to functions which will fetch records of that type.
        The functions will be called with the source as 'this' and a list of ids
        or an object (passed straight through from your program) as the sole
        argument.
    */
    recordFetchers: {},

    /**
        Property: JMAP.Connection#recordRefreshers
        Type: String[Function]

        A map of type guids to functions which will refresh records of that
        type. The functions will be called with the source as 'this' and a list
        of ids or an object (passed straight through from your program) as the
        sole argument.
    */
    recordRefreshers: {},

    /**
        Property: JMAP.Connection#recordCommitters
        Type: String[Function]

        A map of type guids to functions which will commit all creates, updates
        and destroys requested for a particular record type.
    */
    recordCommitters: {},

    /**
        Property: JMAP.Connection#queryFetchers
        Type: String[Function]

        A map of query type guids to functions which will fetch the requested
        contents of that query. The function will be called with the source as
        'this' and the query as the sole argument.
    */
    queryFetchers: {},

    didFetch: function ( Type, args, isAll ) {
        var store = this.get( 'store' );
        var list = args.list;
        var state = args.state;
        var notFound = args.notFound;
        var accountId = args.accountId;
        // Although this must not be null according to the spec, we use a null
        // value when handling errors (see error/_get) so that we can skip the
        // sourceDidFetchRecords call.
        if ( list ) {
            store.sourceDidFetchRecords( accountId, Type, list, state, isAll );
        }
        if ( notFound && notFound.length ) {
            store.sourceCouldNotFindRecords( accountId, Type, notFound );
        }
    },

    didFetchUpdates: function ( Type, args, hasDataForUpdated ) {
        var created = args.created;
        var updated = null;
        if ( !hasDataForUpdated ) {
            if ( updated ) {
                updated = args.updated;
            }
            if ( created ) {
                updated = updated ? updated.concat( created ) : created;
            }
        }
        this.get( 'store' )
            .sourceDidFetchUpdates(
                args.accountId,
                Type,
                updated,
                args.destroyed || null,
                args.oldState,
                args.newState
            );
    },

    didCommit: function ( Type, args ) {
        var store = this.get( 'store' );
        var accountId = args.accountId;
        var toStoreKey = store.getStoreKey.bind( store, accountId, Type );
        var list, object;

        if ( ( object = args.created ) && Object.keys( object ).length ) {
            store.sourceDidCommitCreate( object );
        }
        if (( object = args.notCreated )) {
            list = Object.keys( object );
            if ( list.length ) {
                store.sourceDidNotCreate( list, true, Object.values( object ) );
            }
        }
        if (( object = args.updated )) {
            list = Object.keys( object );
            if ( list.length ) {
                store.sourceDidCommitUpdate( list.map( toStoreKey ) )
                     .sourceDidFetchPartialRecords( accountId, Type, object );
            }
        }
        if (( object = args.notUpdated )) {
            list = Object.keys( object );
            if ( list.length ) {
                store.sourceDidNotUpdate(
                    list.map( toStoreKey ), true, Object.values( object ) );
            }
        }
        if ( ( list = args.destroyed ) && list.length ) {
            store.sourceDidCommitDestroy( list.map( toStoreKey ) );
        }
        if (( object = args.notDestroyed )) {
            list = Object.keys( object );
            if ( list.length ) {
                store.sourceDidNotDestroy(
                    list.map( toStoreKey ), true, Object.values( object ) );
            }
        }
        if ( args.newState ) {
            store.sourceCommitDidChangeState(
                accountId, Type, args.oldState, args.newState );
        }
    },

    didCopy: function ( Type, args, requestArgs ) {
        if ( requestArgs.onSuccessDestroyOriginal ) {
            const notCopied = args.notCreated;
            if ( notCopied ) {
                const fromAccountId = args.fromAccountId;
                const store = this.get( 'store' );
                const storeKeys =
                    Object.keys( notCopied ).map( function ( storeKey ) {
                        const id = requestArgs.create[ storeKey ].id;
                        return store.getStoreKey( fromAccountId, Type, id );
                    });
                store.sourceDidNotDestroy( storeKeys, true );
            }
            this.didCommit( Type, args );
        }
    },

    fetchMoreChanges: function ( accountId, Type ) {
        // Needs to be queued after, because the callback that clears
        // the Type's LOADING flag in the store runs in the middle
        // queue, and until that's cleared this request will be ignored
        var store = this.get( 'store' );
        RunLoop.queueFn( 'after', function () {
            store.fetchAll( accountId, Type, true );
        });
    },

    /**
        Property: JMAP.Connection#response
        Type: String[Function]

        A map of method names to functions which the server can call in a
        response to return data to the client.
    */
    response: {
        error: function ( args, requestName, requestArgs ) {
            var handled = false;
            var response = this.response;
            var type = args.type;
            var method = 'error_' + requestName + '_' + type;
            if ( response[ method ] ) {
                response[ method ].call( this, args, requestName, requestArgs );
                handled = true;
            } else {
                method = 'error_' + requestName;
                if ( response[ method ] ) {
                    response[ method ].call(
                        this, args, requestName, requestArgs );
                    handled = true;
                } else {
                    method = 'error_' +
                        requestName.slice( requestName.indexOf( '/' ) );
                    if ( response[ method ] ) {
                        response[ method ].call(
                            this, args, requestName, requestArgs );
                        handled = true;
                    }
                }
                method = 'error_' + type;
                if ( response[ method ] ) {
                    response[ method ].call(
                        this, args, requestName, requestArgs );
                    handled = true;
                }
            }
            if ( !handled ) {
                console.log( 'Unhandled error: ' + type + '\n\n' +
                    JSON.stringify( args, null, 2 ) );
            }
        },

        // ---

        'error_/get': function ( args, requestName, requestArgs ) {
            var ids = requestArgs.ids;
            if ( ids ) {
                var store = this.get( 'store' );
                var accountId = requestArgs.accountId;
                var typeId = requestName.slice( 0, requestName.indexOf( '/' ) );
                var Type = this._typeIdToType[ typeId ];
                ids.forEach( function ( id ) {
                    var storeKey = store.getStoreKey( accountId, Type, id );
                    var status = store.getStatus( storeKey );
                    store.setStatus( storeKey, status & ~LOADING );
                });
            }
        },

        'error_/set': function ( args, requestName, requestArgs ) {
            var create = requestArgs.create;
            var update = requestArgs.update;
            var destroy = requestArgs.destroy;
            var fakeArgs = {
                accountId: requestArgs.accountId,
                notCreated: create ? Object.keys( create ).reduce(
                    function ( notCreated, storeKey ) {
                        notCreated[ storeKey ] = args;
                        return notCreated;
                    }, {} ) : null,
                notUpdated: update ? Object.keys( update ).reduce(
                    function ( notUpdated, id ) {
                        notUpdated[ id ] = args;
                        return notUpdated;
                    }, {} ) : null,
                notDestroyed: destroy ? destroy.reduce(
                    function ( notDestroyed, id ) {
                        notDestroyed[ id ] = args;
                        return notDestroyed;
                    }, {} ) : null,
            };
            var handler = this.response[ requestName ];
            if ( handler ) {
                handler.call( this, fakeArgs, requestName, requestArgs );
            }
        },


        'error_/copy': function ( args, requestName, requestArgs ) {
            var create = requestArgs.create;
            var fakeArgs = {
                accountId: requestArgs.accountId,
                notCreated: create ? Object.keys( create ).reduce(
                    function ( notCreated, storeKey ) {
                        notCreated[ storeKey ] = args;
                        return notCreated;
                    }, {} ) : null,
            };
            var handler = this.response[ requestName ];
            if ( handler ) {
                handler.call( this, fakeArgs, requestName, requestArgs );
            }
        },

        // ---

        // eslint-disable-next-line camelcase
        error_accountNotFound: function (/* args, requestName, requestArgs */) {
            auth.fetchSession();
        },

        // eslint-disable-next-line camelcase
        error_accountReadOnly: function (/* args, requestName, requestArgs */) {
            auth.fetchSession();
        },

        // eslint-disable-next-line camelcase
        error_accountNotSupportedByMethod:
                function (/* args, requestName, requestArgs */) {
            auth.fetchSession();
        },

        // eslint-disable-next-line camelcase
        error_serverFail: function ( args/*, requestName, requestArgs*/ ) {
            console.log( 'Server error: ' + JSON.stringify( args, null, 2 ) );
        },

        // eslint-disable-next-line camelcase
        error_unknownMethod: function ( args, requestName/*, requestArgs*/ ) {
            // eslint-disable-next-line no-console
            console.log( 'Unknown API call made: ' + requestName );
        },

        // eslint-disable-next-line camelcase
        error_invalidArguments: function ( args, requestName, requestArgs ) {
            // eslint-disable-next-line no-console
            console.log( 'API call to ' + requestName +
                ' made with invalid arguments: ', requestArgs );
        },

        // eslint-disable-next-line camelcase
        error_requestTooLarge: function ( args, requestName, requestArgs ) {
            // eslint-disable-next-line no-console
            console.log( 'API call to ' + requestName +
                ' was too large: ', requestArgs );
        },
    },
});

Connection.makeSetRequest = makeSetRequest;
Connection.makePatches = makePatches;
Connection.makeUpdate = makeUpdate;
Connection.applyPatch = applyPatch;

JMAP.Connection = Connection;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: connections.js                                                       \\
// Module: API                                                                \\
// Requires: Auth.js, Connection.js                                           \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const IOQueue = O.IOQueue;
const AggregateSource = O.AggregateSource;
const Store = O.Store;

const Connection = JMAP.Connection;
const auth = JMAP.auth;

// ---

const upload = new IOQueue({
    maxConnections: 3
});

const mail = new Connection({
    id: 'mail',
});
const contacts = new Connection({
    id: 'contacts',
});
const calendar = new Connection({
    id: 'calendar',
});
const peripheral = new Connection({
    id: 'peripheral',
});

const source = new AggregateSource({
    sources: [ mail, contacts, calendar, peripheral ],
    hasInFlightChanges: function () {
        return this.sources.some( function ( source ) {
            var inFlightRemoteCalls = source.get( 'inFlightRemoteCalls' );
            return inFlightRemoteCalls && inFlightRemoteCalls.some(
                function ( req ) {
                    var method = req[0];
                    var type = method.slice( method.indexOf( '/' ) + 1 );
                    return type === 'set' || type === 'copy';
                });
        }) || !!upload.get( 'activeConnections' );
    },
});

// (Overriding from Overture, at a designated extension point.)
Store.prototype.getPrimaryAccountIdForType = function ( Type ) {
    return auth.get( 'primaryAccounts' )[ Type.dataGroup ];
};

const store = new Store({
    source: source,
    updateAccounts: function () {
        const accounts = auth.get( 'accounts' );
        const primaryMailAccountId =
            auth.get( 'primaryAccounts' )[ auth.MAIL_DATA ];
        var accountId, account;
        for ( accountId in accounts ) {
            account = accounts[ accountId ];
            this.addAccount( accountId, {
                replaceAccountId: accountId === primaryMailAccountId ?
                    'PLACEHOLDER MAIL ACCOUNT ID' : undefined,
                accountCapabilities: account.accountCapabilities,
            });
        }
    },
});
auth.addObserverForKey( 'accounts', store, 'updateAccounts' );

// --- Export

JMAP.upload = upload;
JMAP.mail = mail;
JMAP.contacts = contacts;
JMAP.calendar = calendar;
JMAP.peripheral = peripheral;
JMAP.source = source;
JMAP.store = store;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: LocalFile.js                                                         \\
// Module: API                                                                \\
// Requires: connections.js                                                   \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const isDestroyed = O.isDestroyed;
const Class = O.Class;
const Obj = O.Object;
const RunLoop = O.RunLoop;
const HttpRequest = O.HttpRequest;

const upload = JMAP.upload;
const auth = JMAP.auth;

// ---

const LocalFile = Class({

    Extends: Obj,

    nextEventTarget: upload,

    init: function ( file, accountId ) {
        this.file = file;
        this.accountId = accountId;
        this.blobId = '';

        // Using NFC form for the filename helps when it uses a combining
        // character that's not in our font. Firefox renders this badly, so
        // does Safari (but in a different way). By normalizing, the whole
        // replacement character will be drawn from the fallback font, which
        // looks much better. (Chrome does this by default anyway.)
        // See PTN425984
        var name = file.name;
        if ( name && name.normalize ) {
            name = name.normalize( 'NFC' );
        }
        // If the OS doesn't have a MIME type for a file (e.g. .ini files)
        // it will give an empty string for type. Attaching .mhtml files may
        // give a bogus "multipart/related" MIME type. The OS may have a bogus
        // content type (e.g. sketchup was (is?) settings "SKP" as the content
        // type on Windows); if there's no slash, ignore the type.
        var type = file.type;
        if ( !type || type.startsWith( 'multipart/' ) ||
                !type.contains( '/' ) ) {
            type = 'application/octet-stream';
        }
        this.name = name ||
            ( 'image.' + ( /\w+$/.exec( file.type ) || [ 'png' ] )[0] );
        this.type = type;
        this.size = file.size;

        this.isTooBig = false;
        this.isUploaded = false;

        this.response = null;
        this.progress = 0;
        this.loaded = 0;

        this._backoff = 500;

        LocalFile.parent.constructor.call( this );
    },

    destroy: function () {
        var request = this._request;
        if ( request ) {
            upload.abort( request );
        }
        LocalFile.parent.destroy.call( this );
    },

    upload: function ( obj, key ) {
        if ( obj && key ) {
            obj.removeObserverForKey( key, this, 'upload' );
        }
        if ( !isDestroyed( this ) ) {
            upload.send(
                this._request = new HttpRequest({
                    nextEventTarget: this,
                    method: 'POST',
                    url: auth.get( 'uploadUrl' ).replace(
                        '{accountId}', encodeURIComponent( this.accountId ) ),
                    headers: {
                        'Authorization': auth.get( 'accessToken' ),
                    },
                    withCredentials: false,
                    responseType: 'json',
                    data: this.file,
                })
            );
        }
        return this;
    },

    _uploadDidProgress: function ( event ) {
        const loaded = event.loaded;
        const total = event.total;
        const delta = loaded - this.get( 'loaded' );
        const progress = ~~( 100 * loaded / total );
        this.set( 'progress', progress )
            .set( 'loaded', loaded )
            .fire( 'localfile:progress', {
                loaded: loaded,
                total: total,
                delta: delta,
                progress: progress,
            });
    }.on( 'io:uploadProgress' ),

    _uploadDidSucceed: function ( event ) {
        var response = event.data;

        // Was there an error?
        if ( !response ) {
            return this.uploadDidFail();
        }

        this.beginPropertyChanges()
            .set( 'response', response )
            .set( 'blobId', response.blobId )
            .set( 'progress', 100 )
            .set( 'isUploaded', true )
            .endPropertyChanges()
            .uploadDidSucceed();
    }.on( 'io:success' ),

    _uploadDidFail: function ( event ) {
        this.set( 'progress', 0 );

        switch ( event.status ) {
        // case 400: // Bad Request
        // case 403: // Forbidden
        // case 415: // Unsupported Media Type
        //     break;
        case 401: // Unauthorized
            auth.didLoseAuthentication()
                .addObserverForKey( 'isAuthenticated', this, 'upload' );
            break;
        case 404: // Not Found
            auth.fetchSession()
                .addObserverForKey( 'uploadUrl', this, 'upload' );
            break;
        case 413: // Request Entity Too Large
            this.set( 'isTooBig', true );
            break;
        case 0:   // Connection failed
        case 429: // Rate limited
        case 502: // Bad Gateway
        case 503: // Service Unavailable
        case 504: // Gateway Timeout
            RunLoop.invokeAfterDelay( this.upload, this._backoff, this );
            this._backoff = Math.min( this._backoff * 2, 30000 );
            return;
        }

        this.uploadDidFail();
    }.on( 'io:failure' ),

    _uploadDidEnd: function ( event ) {
        var request = event.target;
        request.destroy();
        if ( this._request === request ) {
            this._request = null;
        }
    }.on( 'io:end' ),

    uploadDidSucceed: function () {
        this.fire( 'localfile:success' );
    },

    uploadDidFail: function () {
        this.fire( 'localfile:failure' );
    },
});

// --- Export

JMAP.LocalFile = LocalFile;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Sequence.js                                                          \\
// Module: API                                                                \\
// Requires: namespace.js                                                     \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Class = O.Class;
const Obj = O.Object;

// ---

const noop = function () {};

const Sequence = Class({

    Extends: Obj,

    init: function () {
        this.queue = [];
        this.index = 0;
        this.length = 0;
        this.afterwards = noop;

        Sequence.parent.constructor.call( this );
    },

    then: function ( fn ) {
        this.queue.push( fn );
        this.increment( 'length', 1 );
        return this;
    },

    lastly: function ( fn ) {
        this.afterwards = fn;
        return this;
    },

    go: function go ( data ) {
        var index = this.index;
        var length = this.length;
        if ( index < length ) {
            this.set( 'index', index + 1 );
            this.queue[ index ]( go.bind( this ), data );
        } else if ( index === length ) {
            this.afterwards( index, length );
        }
        return this;
    },

    cancel: function () {
        var index = this.index;
        var length = this.length;
        if ( index < length ) {
            this.set( 'length', 0 );
            this.afterwards( index, length );
            this.fire( 'cancel' );
        }
        return this;
    },

    progress: function () {
        var index = this.index,
            length = this.length;
        return length ? Math.round( ( index / length ) * 100 ) : 100;
    }.property( 'index', 'length' ),
});

JMAP.Sequence = Sequence;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: getQueryId.js                                                        \\
// Module: API                                                                \\
// Requires: namespace.js                                                     \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP )  {

const guid = O.guid;

// ---

const stringifySorted = function ( item ) {
    if ( !item || ( typeof item !== 'object' ) ) {
        return JSON.stringify( item );
    }
    if ( item instanceof Array ) {
        return '[' + item.map( stringifySorted ).join( ',' ) + ']';
    }
    var keys = Object.keys( item );
    keys.sort();
    return '{' + keys.map( function ( key ) {
        return '"' + key + '":' + stringifySorted( item[ key ] );
    }).join( ',' ) + '}';
};

const getQueryId = function ( Type, args ) {
    return guid( Type ) + ':' + (
        ( args.accountId || '' ) +
        stringifySorted( args.where || args.filter || null ) +
        stringifySorted( args.sort || null )
    ).hash().toString();
};

// --- Export

JMAP.getQueryId = getQueryId;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: uuid.js                                                              \\
// Module: API                                                                \\
// Requires: namespace.js                                                     \\
// -------------------------------------------------------------------------- \\

/*global JMAP */

'use strict';

( function ( JMAP ) {

const create = function () {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace( /[xy]/g,
    function ( c ) {
        var r = ( Math.random() * 16 )|0;
        var v = c === 'x' ? r : ( r & 0x3 | 0x8 );
        return v.toString( 16 );
    });
};

const mapFromArray = function ( array ) {
    return array && array.reduce( function ( object, item ) {
        object[ create() ] = item;
        return object;
    }, {} );
};

const uuid = {
    create: create,
    mapFromArray: mapFromArray,
};

// --- Export

JMAP.uuid = uuid;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Calendar.js                                                          \\
// Module: CalendarModel                                                      \\
// Requires: API                                                              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP, undefined ) {

const loc = O.loc;
const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;
const ValidationError = O.ValidationError;
const DESTROYED = O.Status.DESTROYED;

// ---

const Calendar = Class({

    Extends: Record,

    name: attr( String, {
        defaultValue: '',
        validate: function ( propValue/*, propKey, record*/ ) {
            if ( !propValue ) {
                return new ValidationError( ValidationError.REQUIRED,
                    loc( 'S_LABEL_REQUIRED' )
                );
            }
            return null;
        },
    }),

    color: attr( String, {
        defaultValue: '#3a429c',
    }),

    sortOrder: attr( Number, {
        defaultValue: 0,
    }),

    isSubscribed: attr( Boolean, {
        defaultValue: true,
    }),

    isVisible: attr( Boolean, {
        defaultValue: true,
    }),

    isEventsShown: function () {
        return this.get( 'isSubscribed' ) && this.get( 'isVisible' );
    }.property( 'isSubscribed', 'isVisible' ),

    cascadeChange: function ( _, key, oldValue, newValue ) {
        var store = this.get( 'store' );
        var calendarSK = this.get( 'storeKey' );
        var property = 'calendar-' + key;
        if ( !store.isNested ) {
            store.getAll( JMAP.CalendarEvent, function ( data ) {
                return data.calendarId === calendarSK;
            }).forEach( function ( event ) {
                if ( event.get( 'recurrenceRule' ) ||
                        event.get( 'recurrenceOverrides' ) ) {
                    var cache = event._ocache;
                    var id;
                    for ( id in cache ) {
                        cache[ id ].propertyDidChange(
                            property, oldValue, newValue );
                    }
                } else {
                    event.propertyDidChange( property, oldValue, newValue );
                }
            });
        }
    }.observes( 'name', 'color' ),

    calendarWasDestroyed: function () {
        if ( this.get( 'status' ) === DESTROYED ) {
            var store = this.get( 'store' );
            var calendarSK = this.get( 'storeKey' );
            if ( !store.isNested ) {
                store.findAll( JMAP.CalendarEvent, function ( data ) {
                    return data.calendarId === calendarSK;
                }).forEach( function ( storeKey ) {
                    store.setStatus( storeKey, DESTROYED )
                         .unloadRecord( storeKey );
                });
            }
        }
    }.observes( 'status' ),

    // ---

    mayReadFreeBusy: attr( Boolean, {
        defaultValue: true,
    }),
    mayReadItems: attr( Boolean, {
        defaultValue: true,
    }),
    mayAddItems: attr( Boolean, {
        defaultValue: true,
    }),
    mayModifyItems: attr( Boolean, {
        defaultValue: true,
    }),
    mayRemoveItems: attr( Boolean, {
        defaultValue: true,
    }),

    mayRename: attr( Boolean, {
        defaultValue: true,
    }),
    mayDelete: attr( Boolean, {
        defaultValue: true,
    }),

    mayWrite: function ( mayWrite ) {
        if ( mayWrite !== undefined ) {
            this.set( 'mayAddItems', mayWrite )
                .set( 'mayModifyItems', mayWrite )
                .set( 'mayRemoveItems', mayWrite );
        } else {
            mayWrite = this.get( 'mayAddItems' ) &&
                this.get( 'mayModifyItems' ) &&
                this.get( 'mayRemoveItems' );
        }
        return mayWrite;
    }.property( 'mayAddItems', 'mayModifyItems', 'mayRemoveItems' ),
});
Calendar.__guid__ = 'Calendar';
Calendar.dataGroup = 'urn:ietf:params:jmap:calendars';

JMAP.calendar.handle( Calendar, {

    precedence: 2,

    fetch: 'Calendar',
    refresh: 'Calendar',
    commit: 'Calendar',

    // ---

    'Calendar/get': function ( args, reqMethod, reqArgs ) {
        const isAll = ( reqArgs.ids === null );
        this.didFetch( Calendar, args, isAll );
    },

    'Calendar/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( Calendar, args, hasDataForChanged );
        if ( args.hasMoreChanges ) {
            this.fetchMoreChanges( args.accountId, Calendar );
        }
    },

    'error_Calendar/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( accountId, Calendar );
    },

    'Calendar/set': function ( args ) {
        this.didCommit( Calendar, args );
    },
});

// --- Export

JMAP.Calendar = Calendar;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Duration.js                                                          \\
// Module: CalendarModel                                                      \\
// -------------------------------------------------------------------------- \\

/*global JMAP */

'use strict';

( function ( JMAP ) {

// ---

const durationFormat = /^([+-]?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:\.\d+)?S)?)?$/;

const A_DAY = 24 * 60 * 60 * 1000;

class Duration {
    constructor ( durationInMS ) {
        this._durationInMS = durationInMS;
    }

    valueOf () {
        return this._durationInMS;
    }

    toJSON () {
        var output = 'P';
        var durationInMS = this._durationInMS;
        var quantity;

        if ( durationInMS < 0 ) {
            durationInMS = -durationInMS;
            output = '-P';
        }

        // According to RFC3339 we can't mix weeks with other durations.
        // We could mix days, but presume that anything that's not an exact
        // number of days is a timed event and so better expressed just in
        // hours, as this is not subject to time zone discontinuities.
        if ( durationInMS >= A_DAY && durationInMS % A_DAY === 0 ) {
            quantity = durationInMS / A_DAY;
            if ( quantity % 7 === 0 ) {
                output += quantity / 7;
                output += 'W';
            } else {
                output += quantity;
                output += 'D';
            }
            durationInMS = 0;
        }

        if ( durationInMS ) {
            output += 'T';
            switch ( true ) {
            // Hours
            case durationInMS >= 60 * 60 * 1000:
                quantity = Math.floor( durationInMS / ( 60 * 60 * 1000 ) );
                output += quantity;
                output += 'H';
                durationInMS -= quantity * 60 * 60 * 1000;
                /* falls through */
            // Minutes
            case durationInMS >= 60 * 1000: // eslint-disable-line no-fallthrough
                quantity = Math.floor( durationInMS / ( 60 * 1000 ) );
                output += quantity;
                output += 'M';
                durationInMS -= quantity * 60 * 1000;
                /* falls through */
            // Seconds
            default: // eslint-disable-line no-fallthrough
                quantity = Math.floor( durationInMS / 1000 );
                output += quantity;
                output += 'S';
            }
        }

        return output;
    }

    static isEqual ( a, b ) {
        return a._durationInMS === b._durationInMS;
    }

    static fromJSON ( value ) {
        var results = value ? durationFormat.exec( value ) : null;
        var durationInMS = 0;
        if ( results ) {
            durationInMS += ( +results[2] || 0 ) * 7 * 24 * 60 * 60 * 1000;
            durationInMS += ( +results[3] || 0 )     * 24 * 60 * 60 * 1000;
            durationInMS += ( +results[4] || 0 )          * 60 * 60 * 1000;
            durationInMS += ( +results[5] || 0 )               * 60 * 1000;
            durationInMS += ( +results[6] || 0 )                    * 1000;
            if ( results[1] === '-' ) {
                durationInMS = -durationInMS;
            }
        }
        return new Duration( durationInMS );
    }
}

Duration.ZERO = new Duration( 0 );
Duration.AN_HOUR = new Duration( 60 * 60 * 1000 );
Duration.A_DAY = new Duration( A_DAY );

// --- Export

JMAP.Duration = Duration;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: RecurrenceRule.js                                                    \\
// Module: CalendarModel                                                      \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const toBoolean = O.Transform.toBoolean;

// ---

const YEARLY = 1;
const MONTHLY = 2;
const WEEKLY = 3;
const DAILY = 4;
const HOURLY = 5;
const MINUTELY = 6;
const SECONDLY = 7;

const frequencyNumbers = {
    yearly: YEARLY,
    monthly: MONTHLY,
    weekly: WEEKLY,
    daily: DAILY,
    hourly: HOURLY,
    minutely: MINUTELY,
    secondly: SECONDLY,
};

const dayToNumber = {
    su: 0,
    mo: 1,
    tu: 2,
    we: 3,
    th: 4,
    fr: 5,
    sa: 6,
};

const numberToDay = [
    'su',
    'mo',
    'tu',
    'we',
    'th',
    'fr',
    'sa',
];

// ---

const none = 1 << 15;

const getMonth = function ( date, results ) {
    results[0] = date.getUTCMonth();
    results[1] = none;
    results[2] = none;
};

const getDate = function ( date, results, total ) {
    var daysInMonth = total || Date.getDaysInMonth(
            date.getUTCMonth(), date.getUTCFullYear() ) + 1;
    results[0] = date.getUTCDate();
    results[1] = results[0] - daysInMonth;
    results[2] = none;
};

const getDay = function ( date, results ) {
    results[0] = date.getUTCDay();
    results[1] = none;
    results[2] = none;
};

const getDayMonthly = function ( date, results, total ) {
    var day = date.getUTCDay();
    var monthDate = date.getUTCDate();
    var occurrence = Math.floor( ( monthDate - 1 ) / 7 ) + 1;
    var daysInMonth = total || Date.getDaysInMonth(
            date.getUTCMonth(), date.getUTCFullYear() );
    var occurrencesInMonth = occurrence +
            Math.floor( ( daysInMonth - monthDate ) / 7 );
    results[0] = day;
    results[1] = day + ( 7 * occurrence );
    results[2] = day + ( 7 * ( occurrence - occurrencesInMonth - 1 ) );
};

const getDayYearly = function ( date, results, daysInYear ) {
    var day = date.getUTCDay();
    var dayOfYear = date.getDayOfYear( true );
    var occurrence = Math.floor( ( dayOfYear - 1 ) / 7 ) + 1;
    var occurrencesInYear = occurrence +
            Math.floor( ( daysInYear - dayOfYear ) / 7 );
    results[0] = day;
    results[1] = day + ( 7 * occurrence );
    results[2] = day + ( 7 * ( occurrence - occurrencesInYear - 1 ) );
};

const getYearDay = function ( date, results, total ) {
    results[0] = date.getDayOfYear( true );
    results[1] = results[0] - total;
    results[2] = none;
};

const getWeekNo = function ( firstDayOfWeek, date, results, total ) {
    results[0] = date.getISOWeekNumber( firstDayOfWeek, true );
    results[1] = results[0] - total;
    results[2] = none;
};

const getPosition = function ( date, results, total, index ) {
    results[0] = index + 1;
    results[1] = index - total;
    results[2] = none;
};

const filter = function ( array, getValues, allowedValues, total ) {
    var l = array.length;
    var results = [ none, none, none ];
    var date, i, ll, a, b, c, allowed;
    ll = allowedValues.length;
    outer: while ( l-- ) {
        date = array[l];
        if ( date ) {
            getValues( date, results, total, l );
            a = results[0];
            b = results[1];
            c = results[2];
            for ( i = 0; i < ll; i += 1 ) {
                allowed = allowedValues[i];
                if ( allowed === a || allowed === b || allowed === c ) {
                    continue outer;
                }
            }
            array[l] = null;
        }
    }
};

const expand = function ( array, property, values ) {
    var l = array.length, ll = values.length;
    var i, j, k = 0;
    var results = new Array( l * ll );
    var candidate, newCandidate;
    for ( i = 0; i < l; i += 1 ) {
        candidate = array[i];
        for ( j = 0; j < ll; j += 1 ) {
            if ( candidate ) {
                newCandidate = new Date( candidate );
                newCandidate[ property ]( values[j] );
            } else {
                newCandidate = null;
            }
            results[ k ] = newCandidate;
            k += 1;
        }
    }
    return results;
};

// Returns the next set of dates revolving around the interval defined by
// the fromDate. This may include dates *before* the from date.
const iterate = function ( fromDate,
        frequency, interval, firstDayOfWeek,
        byDay, byMonthDay, byMonth, byYearDay, byWeekNo,
        byHour, byMinute, bySecond, bySetPosition ) {

    var candidates = [];
    var maxAttempts =
        ( frequency === YEARLY ) ? 10 :
        ( frequency === MONTHLY ) ? 24 :
        ( frequency === WEEKLY ) ? 53 :
        ( frequency === DAILY ) ? 366 :
        ( frequency === HOURLY ) ? 48 :
        /* MINUTELY || SECONDLY */ 120;
    var useFastPath =
        !byDay && !byMonthDay && !byMonth && !byYearDay && !byWeekNo;

    var year, month, date, hour, minute, second;
    var i, daysInMonth, offset, candidate, lastDayInYear, weeksInYear;

    switch ( frequency ) {
        case SECONDLY:
            useFastPath = useFastPath && !bySecond;
            /* falls through */
        case MINUTELY:
            useFastPath = useFastPath && !byMinute;
            /* falls through */
        case HOURLY:
            useFastPath = useFastPath && !byHour;
            break;
    }

    // It's possible to write rules which don't actually match anything.
    // Limit the maximum number of cycles we are willing to pass through
    // looking for a new candidate.
    while ( maxAttempts-- ) {
        year = fromDate.getUTCFullYear();
        month = fromDate.getUTCMonth();
        date = fromDate.getUTCDate();
        hour = fromDate.getUTCHours();
        minute = fromDate.getUTCMinutes();
        second = fromDate.getUTCSeconds();

        // Fast path
        if ( useFastPath ) {
            candidates.push( fromDate );
        } else {
            // 1. Build set of candidates.
            switch ( frequency ) {
            // We do the filtering of bySecond/byMinute/byHour in the
            // candidate generation phase for SECONDLY, MINUTELY and HOURLY
            // frequencies.
            case SECONDLY:
                if ( bySecond && bySecond.indexOf( second ) < 0 ) {
                    break;
                }
                /* falls through */
            case MINUTELY:
                if ( byMinute && byMinute.indexOf( minute ) < 0 ) {
                    break;
                }
                /* falls through */
            case HOURLY:
                if ( byHour && byHour.indexOf( hour ) < 0 ) {
                    break;
                }
                lastDayInYear = new Date( Date.UTC(
                    year, 11, 31, hour, minute, second
                ));
                /* falls through */
            case DAILY:
                candidates.push( new Date( Date.UTC(
                    year, month, date, hour, minute, second
                )));
                break;
            case WEEKLY:
                offset = ( fromDate.getUTCDay() - firstDayOfWeek ).mod( 7 );
                for ( i = 0; i < 7; i += 1 ) {
                    candidates.push( new Date( Date.UTC(
                        year, month, date - offset + i, hour, minute, second
                    )));
                }
                break;
            case MONTHLY:
                daysInMonth = Date.getDaysInMonth( month, year );
                for ( i = 1; i <= daysInMonth; i += 1 ) {
                    candidates.push( new Date( Date.UTC(
                        year, month, i, hour, minute, second
                    )));
                }
                break;
            case YEARLY:
                candidate = new Date( Date.UTC(
                    year, 0, 1, hour, minute, second
                ));
                lastDayInYear = new Date( Date.UTC(
                    year, 11, 31, hour, minute, second
                ));
                while ( candidate <= lastDayInYear ) {
                    candidates.push( candidate );
                    candidate = new Date( +candidate + 86400000 );
                }
                break;
            }

            // 2. Apply restrictions and expansions
            if ( byMonth ) {
                filter( candidates, getMonth, byMonth );
            }
            if ( byMonthDay ) {
                filter( candidates, getDate, byMonthDay,
                    daysInMonth ? daysInMonth + 1 : 0
                );
            }
            if ( byDay ) {
                if ( frequency !== MONTHLY &&
                        ( frequency !== YEARLY || byWeekNo ) ) {
                    filter( candidates, getDay, byDay );
                } else if ( frequency === MONTHLY || byMonth ) {
                    // Filter candidates using position of day in month
                    filter( candidates, getDayMonthly, byDay,
                        daysInMonth || 0 );
                } else {
                    // Filter candidates using position of day in year
                    filter( candidates, getDayYearly, byDay,
                        Date.getDaysInYear( year ) );
                }
            }
            if ( byYearDay ) {
                filter( candidates, getYearDay, byYearDay,
                    lastDayInYear.getDayOfYear( true ) + 1
                );
            }
            if ( byWeekNo ) {
                weeksInYear =
                    lastDayInYear.getISOWeekNumber( firstDayOfWeek, true );
                if ( weeksInYear === 1 ) {
                    weeksInYear = 52;
                }
                filter( candidates, getWeekNo.bind( null, firstDayOfWeek ),
                    byWeekNo,
                    weeksInYear + 1
                );
            }
        }
        if ( byHour && frequency !== HOURLY &&
                frequency !== MINUTELY && frequency !== SECONDLY ) {
            candidates = expand( candidates, 'setUTCHours', byHour );
        }
        if ( byMinute &&
                frequency !== MINUTELY && frequency !== SECONDLY ) {
            candidates = expand( candidates, 'setUTCMinutes', byMinute );
        }
        if ( bySecond && frequency !== SECONDLY ) {
            candidates = expand( candidates, 'setUTCSeconds', bySecond );
        }
        if ( bySetPosition ) {
            candidates = candidates.filter( toBoolean );
            filter( candidates, getPosition, bySetPosition, candidates.length );
        }

        // 3. Increment anchor by frequency/interval
        fromDate = new Date( Date.UTC(
            ( frequency === YEARLY ) ? year + interval : year,
            ( frequency === MONTHLY ) ? month + interval : month,
            ( frequency === WEEKLY ) ? date + 7 * interval :
            ( frequency === DAILY ) ? date + interval : date,
            ( frequency === HOURLY ) ? hour + interval : hour,
            ( frequency === MINUTELY ) ? minute + interval : minute,
            ( frequency === SECONDLY ) ? second + interval : second
        ));

        // 4. Do we have any candidates left?
        candidates = candidates.filter( toBoolean );
        if ( candidates.length ) {
            return [ candidates, fromDate ];
        }
    }
    return [ null, fromDate ];
};

// ---

class RecurrenceRule {

    constructor ( json ) {
        this.frequency = frequencyNumbers[ json.frequency ] || DAILY;
        this.interval = json.interval || 1;

        var firstDayOfWeek = dayToNumber[ json.firstDayOfWeek ];
        this.firstDayOfWeek =
            0 <= firstDayOfWeek && firstDayOfWeek < 7 ? firstDayOfWeek : 1;
        // Convert { day: "monday", nthOfPeriod: -1 } to -6 etc.
        this.byDay = json.byDay ? json.byDay.map( function ( nDay ) {
            return dayToNumber[ nDay.day ] + 7 * ( nDay.nthOfPeriod || 0 );
        }) : null;
        this.byMonthDay = json.byMonthDay || null;
        // Convert "1" (Jan), "2" (Feb) etc. to 0 (Jan), 1 (Feb)
        this.byMonth = json.byMonth ? json.byMonth.map( function ( month ) {
            return parseInt( month, 10 ) - 1;
        }) : null;
        this.byYearDay = json.byYearDay || null;
        this.byWeekNo = json.byWeekNo || null;

        this.byHour = json.byHour || null;
        this.byMinute = json.byMinute || null;
        this.bySecond = json.bySecond || null;

        this.bySetPosition = json.bySetPosition || null;

        this.until = json.until ? Date.fromJSON( json.until ) : null;
        // Arbitrary limit of 2^14 – after that ignore the count and treat as
        // infinite; we presume we can list all occurrences if there is a
        // count without being too expensive. Don't die trying to compute them
        // if someone accidentally or on purpose puts a pathologically large
        // count.
        this.count = json.count <= 16384 && json.count || null;
    }

    toJSON () {
        var result = {
            '@type': 'RecurrenceRule',
        };
        var key, value;
        for ( key in this ) {
            if ( key.charAt( 0 ) === '_' || !this.hasOwnProperty( key ) ) {
                continue;
            }
            value = this[ key ];
            if ( value === null ) {
                continue;
            }
            switch ( key ) {
            case 'frequency':
                value = Object.keyOf( frequencyNumbers, value );
                break;
            case 'interval':
                if ( value === 1 ) {
                    continue;
                }
                break;
            case 'firstDayOfWeek':
                if ( value === 1 ) {
                    continue;
                }
                value = numberToDay[ value ];
                break;
            case 'byDay':
                /* jshint ignore:start */
                value = value.map( function ( day ) {
                    return 0 <= day && day < 7 ? {
                        day: numberToDay[ day ]
                    } : {
                        day: numberToDay[ day.mod( 7 ) ],
                        nthOfPeriod: Math.floor( day / 7 )
                    };
                });
                break;
            case 'byMonth':
                value = value.map( function ( month ) {
                    return ( month + 1 ) + '';
                });
                /* jshint ignore:end */
                break;
            case 'until':
                value = value.toJSON();
                break;
            }
            result[ key ] = value;
        }
        return result;
    }

    // start = Date recurrence starts (should be first occurrence)
    // begin = Beginning of time period to return occurrences within
    // end = End of time period to return occurrences within
    getOccurrences ( start, begin, end ) {
        var frequency = this.frequency;
        var count = this.count || 0;
        var until = this.until;
        var interval = this.interval;
        var firstDayOfWeek = this.firstDayOfWeek;
        var byDay = this.byDay;
        var byMonthDay = this.byMonthDay;
        var byMonth = this.byMonth;
        var byYearDay = this.byYearDay;
        var byWeekNo = this.byWeekNo;
        var byHour = this.byHour;
        var byMinute = this.byMinute;
        var bySecond = this.bySecond;
        var bySetPosition = this.bySetPosition;

        var results = [];
        var periodLengthInMS = interval;
        var year, month, date;
        var beginYear, beginMonth;
        var isComplexAnchor, anchor, temp, occurrences, occurrence, i, l;

        // Make sure we have a start date, and make sure it will terminate
        if ( !start ) {
            start = new Date();
        }
        if ( !begin || begin <= start ) {
            begin = start;
        }
        if ( !end && !until && !count ) {
            count = 2;
        }
        if ( until && until <= start ) {
            until = null;
            count = 1;
        }
        if ( until && ( !end || end > until ) ) {
            end = new Date( +until + 1000 );
        }
        if ( end && begin >= end ) {
            return results;
        }

        // An anchor is a date == start + x * (interval * frequency)
        // An anchor may return occurrences earlier than it.
        // Anchor results do not overlap.
        // For monthly/yearly recurrences, we have to generate a "false" anchor
        // and use the slow path if the start date may not exist in some cycles
        // e.g. 31st December repeat monthly -> no 31st in some months.
        year = start.getUTCFullYear();
        month = start.getUTCMonth();
        date = start.getUTCDate();
        isComplexAnchor = date > 28 &&
            ( frequency === MONTHLY || (frequency === YEARLY && month === 1) );

        // Check it's sane.
        if ( interval < 1 ) {
            interval = 1;
        }

        // Ignore illegal restrictions:
        if ( frequency !== YEARLY ) {
            byWeekNo = null;
        }
        switch ( frequency ) {
            case WEEKLY:
                byMonthDay = null;
                /* falls through */
            case DAILY:
            case MONTHLY:
                byYearDay = null;
                break;
        }

        // Only inherit-from-start cases not handled by the fast path.
        if ( frequency === YEARLY && !byYearDay ) {
            if ( !byWeekNo ) {
                if ( byMonthDay && !byMonth ) {
                    if ( !byDay && byMonthDay.length === 1 &&
                            byMonthDay[0] === date ) {
                        // This is actually just a standard FREQ=YEARLY
                        // recurrence expressed inefficiently; put it back on
                        // the fast path
                        byMonthDay = null;
                    } else {
                        byMonth = [ month ];
                    }
                }
                if ( byMonth && !byDay && !byMonthDay ) {
                    byMonthDay = [ date ];
                }
            } else if ( !byDay && !byMonthDay ) {
                byDay = [ start.getUTCDay() ];
            }
        }
        if ( frequency === MONTHLY && byMonth && !byMonthDay && !byDay ) {
            byMonthDay = [ date ];
        }
        if ( frequency === WEEKLY && byMonth && !byDay ) {
            byDay = [ start.getUTCDay() ];
        }

        // Deal with monthly/yearly repetitions where the anchor may not exist
        // in some cycles. Must not use fast path.
        if ( isComplexAnchor &&
                !byDay && !byMonthDay && !byMonth && !byYearDay && !byWeekNo ) {
            byMonthDay = [ date ];
            if ( frequency === YEARLY ) {
                byMonth = [ month ];
            }
        }

        // Must always iterate from the start if there's a count
        if ( count || begin === start ) {
            // Anchor will be created below if complex
            if ( !isComplexAnchor ) {
                anchor = start;
            }
        } else {
            // Find first anchor before or equal to "begin" date.
            switch ( frequency ) {
            case YEARLY:
                // Get year of range begin.
                // Subtract year of start
                // Find remainder modulo interval;
                // Subtract from range begin year so we're on an interval.
                beginYear = begin.getUTCFullYear();
                year = beginYear - ( ( beginYear - year ) % interval );
                break;
            case MONTHLY:
                beginYear = begin.getUTCFullYear();
                beginMonth = begin.getUTCMonth();
                // Get number of months from event start to range begin
                month = 12 * ( beginYear - year ) + ( beginMonth - month );
                // Calculate the first anchor month <= the begin month/year
                month = beginMonth - ( month % interval );
                year = beginYear;
                // Month could be < 0 if anchor is in previous year
                if ( month < 0 ) {
                    year += Math.floor( month / 12 );
                    month = month.mod( 12 );
                }
                break;
            case WEEKLY:
                periodLengthInMS *= 7;
                /* falls through */
            case DAILY:
                periodLengthInMS *= 24;
                /* falls through */
            case HOURLY:
                periodLengthInMS *= 60;
                /* falls through */
            case MINUTELY:
                periodLengthInMS *= 60;
                /* falls through */
            case SECONDLY:
                periodLengthInMS *= 1000;
                anchor = new Date( begin -
                    ( ( begin - start ) % periodLengthInMS ) );
                break;
            }
        }
        if ( !anchor ) {
            anchor = new Date( Date.UTC(
                year, month, isComplexAnchor ? 1 : date,
                start.getUTCHours(),
                start.getUTCMinutes(),
                start.getUTCSeconds()
            ));
        }

        // If anchor <= start, filter out any dates < start
        // Always filter dates for begin <= date < end
        // If we reach the count limit or find a date >= end, we're done.
        // For sanity, set the count limit to be in the bounds [0,2^14], so
        // we don't enter a near-infinite loop

        if ( count <= 0 || count > 16384 ) {
            count = 16384; // 2 ^ 14
        }

        // Start date is always included according to RFC5545, even if it
        // doesn't match the recurrence
        if ( anchor <= start ) {
            results.push( start );
            count -= 1;
            if ( !count ) {
                return results;
            }
        }

        outer: while ( true ) {
            temp = iterate( anchor,
                frequency, interval, firstDayOfWeek,
                byDay, byMonthDay, byMonth, byYearDay, byWeekNo,
                byHour, byMinute, bySecond, bySetPosition );
            occurrences = temp[0];
            if ( !occurrences ) {
                break;
            }
            if ( anchor <= start ) {
                /* jshint ignore:start */
                occurrences = occurrences.filter( function ( date ) {
                    return date > start;
                });
                /* jshint ignore:end */
            }
            anchor = temp[1];
            for ( i = 0, l = occurrences.length; i < l; i += 1 ) {
                occurrence = occurrences[i];
                if ( end && occurrence >= end ) {
                    break outer;
                }
                if ( begin <= occurrence ) {
                    results.push( occurrence );
                }
                count -= 1;
                if ( !count ) {
                    break outer;
                }
            }
        }

        return results;
    }

    matches ( start, date ) {
        return !!this.getOccurrences( start, date, new Date( +date + 1000 ) )
                     .length;
    }

    static fromJSON ( recurrenceRuleJSON ) {
        return new RecurrenceRule( recurrenceRuleJSON );
    }
}

RecurrenceRule.dayToNumber = dayToNumber;
RecurrenceRule.numberToDay = numberToDay;

RecurrenceRule.YEARLY = YEARLY;
RecurrenceRule.MONTHLY = MONTHLY;
RecurrenceRule.WEEKLY = WEEKLY;
RecurrenceRule.DAILY = DAILY;
RecurrenceRule.HOURLY = HOURLY;
RecurrenceRule.MINUTELY = MINUTELY;
RecurrenceRule.SECONDLY = SECONDLY;

// --- Export

JMAP.RecurrenceRule = RecurrenceRule;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: CalendarEvent.js                                                     \\
// Module: CalendarModel                                                      \\
// Requires: API, Calendar.js, Duration.js, RecurrenceRule.js                 \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP, undefined ) {

const clone = O.clone;
const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;
const TimeZone = O.TimeZone;

const calendar = JMAP.calendar;
const Calendar = JMAP.Calendar;
const Duration = JMAP.Duration;
const RecurrenceRule = JMAP.RecurrenceRule;
const uuidCreate = JMAP.uuid.create;
const YEARLY = RecurrenceRule.YEARLY;
const MONTHLY = RecurrenceRule.MONTHLY;
const WEEKLY = RecurrenceRule.WEEKLY;

// ---

const numerically = function ( a, b ) {
    return a - b;
};

const toNameAndEmail = function ( participant ) {
    var name = participant.name;
    var email = participant.email;
    // Need to quote unless only using atext characters
    // https://tools.ietf.org/html/rfc5322#section-3.2.3
    if ( !/^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]*$/.test( name ) ) {
        name = JSON.stringify( name );
    }
    return name ? name + ' <' + email + '>' : email;
};

const isOwner = function ( participant ) {
    return !!participant.roles.owner;
};

const isValidPatch = function ( object, path ) {
    var slash, key;
    while ( true ) {
        // Invalid patch; path does not exist
        if ( !object ) {
            return false;
        }
        slash = path.indexOf( '/' );
        // We have all the parts of the path before the last; valid patch
        if ( slash === -1 ) {
            return true;
        }
        key = path.slice( 0, slash );
        path = path.slice( slash + 1 );
        key = key.replace( /~1/g, '/' ).replace( /~0/g, '~' );
        object = object[ key ];
    }
};

const CalendarEvent = Class({

    Extends: Record,

    isDragging: false,
    isOccurrence: false,

    isEditable: function () {
        var calendar = this.get( 'calendar' );
        return ( !calendar || calendar.get( 'mayWrite' ) );
    }.property( 'calendar' ),

    isInvitation: function () {
        var participants = this.get( 'participants' );
        var participantId = this.get( 'participantId' );
        return !!( participants && (
            !participantId || !isOwner( participants[ participantId ] )
        ));
    }.property( 'participants', 'participantId' ),

    storeWillUnload: function () {
        this._clearOccurrencesCache();
        CalendarEvent.parent.storeWillUnload.call( this );
    },

    clone: function ( store ) {
        var clone = CalendarEvent.parent.clone.call( this, store );
        return clone
            .set( 'uid', uuidCreate() )
            .set( 'relatedTo', null );
    },

    // --- JMAP

    calendar: Record.toOne({
        Type: Calendar,
        key: 'calendarId',
        willSet: function ( propValue, propKey, record ) {
            record.set( 'accountId', propValue.get( 'accountId' ) );
            return true;
        },
        // By default, to-one attributes are marked volatile in case the
        // referenced record is garbage collected. We don't garbage collect
        // calendars so we can safely cache the attribute value.
        isVolatile: false,
    }),

    // --- Metadata

    '@type': attr( String, {
        defaultValue: 'jsevent',
    }),

    uid: attr( String ),

    relatedTo: attr( Object, {
        defaultValue: null,
    }),

    prodId: attr( String ),

    created: attr( Date, {
        toJSON: Date.toUTCJSON,
        noSync: true,
    }),

    updated: attr( Date, {
        toJSON: Date.toUTCJSON,
        noSync: true,
    }),

    sequence: attr( Number, {
        defaultValue: 0,
        noSync: true,
    }),

    method: attr( String, {
        noSync: true,
    }),

    // --- What

    title: attr( String, {
        defaultValue: '',
    }),

    description: attr( String, {
        defaultValue: '',
    }),

    // --- Where

    locations: attr( Object, {
        defaultValue: null,
        willSet: function ( propValue, propKey, record ) {
            record._removeInvalidPatches();
            return true;
        },
    }),

    location: function ( value ) {
        if ( value !== undefined ) {
            this.set( 'locations', value ? {
                '1': {
                    '@type': 'Location',
                    name: value
                }
            } : null );
        } else {
            var locations = this.get( 'locations' );
            if ( locations ) {
                value = Object.values( locations )[0].name || '';
            } else {
                value = '';
            }
        }
        return value;
    }.property( 'locations' ).nocache(),

    startLocationTimeZone: function () {
        var locations = this.get( 'locations' );
        var timeZone = this.get( 'timeZone' );
        var id, location;
        if ( timeZone ) {
            for ( id in locations ) {
                location = locations[ id ];
                if ( location.relativeTo === 'start' ) {
                    if ( location.timeZone ) {
                        timeZone = TimeZone.fromJSON( location.timeZone );
                    }
                    break;
                }
            }
        }
        return timeZone;
    }.property( 'locations', 'timeZone' ),

    endLocationTimeZone: function () {
        var locations = this.get( 'locations' );
        var timeZone = this.get( 'timeZone' );
        var id, location;
        if ( timeZone ) {
            for ( id in locations ) {
                location = locations[ id ];
                if ( location.relativeTo === 'end' ) {
                    if ( location.timeZone ) {
                        timeZone = TimeZone.fromJSON( location.timeZone );
                    }
                    break;
                }
            }
        }
        return timeZone;
    }.property( 'locations', 'timeZone' ),

    // --- Attachments

    links: attr( Object, {
        defaultValue: null,
        willSet: function ( propValue, propKey, record ) {
            record._removeInvalidPatches();
            return true;
        },
    }),

    // ---

    // locale: attr( String ),
    // localizations: attr( Object ),
    // NOTE: If adding support for localizations, you need to handle this in
    // the mayPatchKey function too, because you can't patch a patch.

    // keywords: attr( Object ),
    // categories: attr( Object ),
    // color: attr( String ),

    // --- When

    isAllDay: attr( Boolean, {
        key: 'showWithoutTime',
        defaultValue: false,
    }),

    start: attr( Date, {
        willSet: function ( propValue, propKey, record ) {
            var oldStart = record.get( 'start' );
            if ( typeof oldStart !== 'undefined' ) {
                record._updateRecurrenceOverrides( oldStart, propValue );
            }
            return true;
        }
    }),

    duration: attr( Duration, {
        defaultValue: 0,
    }),

    timeZone: attr( TimeZone, {
        defaultValue: null,
    }),

    recurrenceId: attr( String ),

    recurrenceRule: attr( RecurrenceRule, {
        defaultValue: null,
        willSet: function ( propValue, propKey, record ) {
            if ( !propValue ) {
                record.set( 'recurrenceOverrides', null );
            }
            return true;
        },
    }),

    recurrenceOverrides: attr( Object, {
        defaultValue: null,
    }),

    getStartInTimeZone: function ( timeZone ) {
        var eventTimeZone = this.get( 'timeZone' );
        var start, cacheKey;
        if ( eventTimeZone && timeZone && timeZone !== eventTimeZone ) {
            start = this.get( 'utcStart' );
            cacheKey = timeZone.id + start.toJSON();
            if ( this._ce_sk === cacheKey ) {
                return this._ce_s;
            }
            this._ce_sk = cacheKey;
            this._ce_s = start = timeZone.convertDateToTimeZone( start );
        } else {
            start = this.get( 'start' );
        }
        return start;
    },

    getEndInTimeZone: function ( timeZone ) {
        var eventTimeZone = this.get( 'timeZone' );
        var end = this.get( 'utcEnd' );
        var cacheKey;
        if ( eventTimeZone ) {
            if ( !timeZone ) {
                timeZone = eventTimeZone;
            }
            cacheKey = timeZone.id + end.toJSON();
            if ( this._ce_ek === cacheKey ) {
                return this._ce_e;
            }
            this._ce_ek = cacheKey;
            this._ce_e = end = timeZone.convertDateToTimeZone( end );
        }
        return end;
    },

    utcStart: function ( date ) {
        var timeZone = this.get( 'timeZone' );
        if ( date ) {
            this.set( 'start', timeZone ?
                timeZone.convertDateToTimeZone( date ) : date );
        } else {
            date = this.get( 'start' );
            if ( timeZone ) {
                date = timeZone.convertDateToUTC( date );
            }
        }
        return date;
    }.property( 'start', 'timeZone' ),

    utcEnd: function ( date ) {
        var utcStart = this.get( 'utcStart' );
        if ( date ) {
            this.set( 'duration', new Duration(
                Math.max( 0, date - utcStart )
            ));
        } else {
            date = new Date( +utcStart + this.get( 'duration' ) );
        }
        return date;
    }.property( 'utcStart', 'duration' ),

    end: function ( date ) {
        var isAllDay = this.get( 'isAllDay' );
        var timeZone = this.get( 'timeZone' );
        var utcStart, utcEnd;
        if ( date ) {
            utcStart = this.get( 'utcStart' );
            utcEnd = timeZone ?
                timeZone.convertDateToUTC( date ) : new Date( date );
            if ( isAllDay ) {
                utcEnd.add( 1, 'day' );
            }
            if ( utcStart > utcEnd ) {
                if ( isAllDay ||
                        !this.get( 'start' ).isOnSameDayAs( date, true ) ) {
                    this.set( 'utcStart', new Date(
                        +utcStart + ( utcEnd - this.get( 'utcEnd' ) )
                    ));
                } else {
                    utcEnd.add( 1, 'day' );
                    date = new Date( date ).add( 1, 'day' );
                }
            }
            this.set( 'utcEnd', utcEnd );
        } else {
            date = this.getEndInTimeZone( timeZone );
            if ( isAllDay ) {
                date = new Date( date ).subtract( 1, 'day' );
            }
        }
        return date;
    }.property( 'isAllDay', 'start', 'duration', 'timeZone' ),

    _updateRecurrenceOverrides: function ( oldStart, newStart ) {
        var recurrenceOverrides = this.get( 'recurrenceOverrides' );
        var newRecurrenceOverrides, delta, date;
        if ( recurrenceOverrides ) {
            delta = newStart - oldStart;
            newRecurrenceOverrides = {};
            for ( date in recurrenceOverrides ) {
                newRecurrenceOverrides[
                    new Date( +Date.fromJSON( date ) + delta ).toJSON()
                ] = recurrenceOverrides[ date ];
            }
            this.set( 'recurrenceOverrides', newRecurrenceOverrides );
        }
    },

    _removeInvalidPatches: function () {
        var recurrenceOverrides = this.get( 'recurrenceOverrides' );
        var hasChanges = false;
        var data, recurrenceId, patches, path;
        if ( recurrenceOverrides ) {
            data = this.getData();
            for ( recurrenceId in recurrenceOverrides ) {
                patches = recurrenceOverrides[ recurrenceId ];
                for ( path in patches ) {
                    if ( !isValidPatch( data, path ) ) {
                        if ( !hasChanges ) {
                            hasChanges = true;
                            recurrenceOverrides = clone( recurrenceOverrides );
                        }
                        delete recurrenceOverrides[ recurrenceId ][ path ];
                    }
                }
            }
            if ( hasChanges ) {
                this.set( 'recurrenceOverrides', recurrenceOverrides );
            }
        }
    }.queue( 'before' ),

    removedDates: function () {
        var recurrenceOverrides = this.get( 'recurrenceOverrides' );
        var dates = null;
        var date;
        if ( recurrenceOverrides ) {
            for ( date in recurrenceOverrides ) {
                if ( recurrenceOverrides[ date ].excluded ) {
                    if ( !dates ) { dates = []; }
                    dates.push( Date.fromJSON( date ) );
                }
            }
        }
        if ( dates ) {
            dates.sort( numerically );
        }
        return dates;
    }.property( 'recurrenceOverrides' ),

    getOccurrenceForRecurrenceId: function ( id ) {
        var cache = this._ocache || ( this._ocache = {} );
        return cache[ id ] || ( cache[ id ] =
            new JMAP.CalendarEventOccurrence( this, id )
        );
    },

    // Return all occurrences that exist in this time range.
    // May return others outside of this range.
    // May return out of order.
    getOccurrencesThatMayBeInDateRange: function ( start, end, timeZone ) {
        // Get start time and end time in the event's time zone.
        var eventTimeZone = this.get( 'timeZone' );
        var recurrenceRule = this.get( 'recurrenceRule' );
        var recurrenceOverrides = this.get( 'recurrenceOverrides' );
        var duration = this.get( 'duration' ).valueOf();
        var earliestStart;
        var occurrences, occurrencesSet, id, occurrence, date;
        var occurrenceIds, recurrences;

        // Convert start/end to local time
        if ( timeZone && eventTimeZone && timeZone !== eventTimeZone ) {
            start = timeZone.convertDateToUTC( start );
            start = eventTimeZone.convertDateToTimeZone( start );
            end = timeZone.convertDateToUTC( end );
            end = eventTimeZone.convertDateToTimeZone( end );
        }

        // Calculate earliest possible start date, given duration.
        // To prevent pathological cases, we limit duration to
        // the frequency of the recurrence.
        if ( recurrenceRule ) {
            switch ( recurrenceRule.frequency ) {
            case YEARLY:
                duration = Math.min( duration, 366 * 24 * 60 * 60 * 1000 );
                break;
            case MONTHLY:
                duration = Math.min( duration,  31 * 24 * 60 * 60 * 1000 );
                break;
            case WEEKLY:
                duration = Math.min( duration,   7 * 24 * 60 * 60 * 1000 );
                break;
            default:
                duration = Math.min( duration,       24 * 60 * 60 * 1000 );
                break;
            }
        }
        earliestStart = new Date( start - duration + 1000 );

        // Precompute count, as it's expensive to do each time.
        if ( recurrenceRule && recurrenceRule.count ) {
            occurrences = this.get( 'allStartDates' );
            recurrences = occurrences.length ?
                occurrences.map( function ( date ) {
                    return this.getOccurrenceForRecurrenceId( date.toJSON() );
                }, this ) :
                null;
        } else {
            // Get occurrences that start within the time period.
            if ( recurrenceRule ) {
                occurrences = recurrenceRule.getOccurrences(
                    this.get( 'start' ), earliestStart, end
                );
            }
            // Or just the start if no recurrence rule.
            else {
                occurrences = [ this.get( 'start' ) ];
            }
            // Add overrides.
            if ( recurrenceOverrides ) {
                occurrencesSet = occurrences.reduce( function ( set, date ) {
                    set[ date.toJSON() ] = true;
                    return set;
                }, {} );
                for ( id in recurrenceOverrides ) {
                    occurrence = recurrenceOverrides[ id ];
                    // Remove EXDATEs.
                    if ( occurrence.excluded ) {
                        delete occurrencesSet[ id ];
                    }
                    // Add RDATEs.
                    else {
                        date = Date.fromJSON( id );
                        // Include if in date range, or if it alters the date.
                        if ( ( earliestStart <= date && date < end ) ||
                                occurrence.start ||
                                occurrence.duration ||
                                occurrence.timeZone ) {
                            occurrencesSet[ id ] = true;
                        }
                    }
                }
                occurrenceIds = Object.keys( occurrencesSet );
            } else {
                occurrenceIds = occurrences.map( function ( date ) {
                    return date.toJSON();
                });
            }
            // Get event occurrence objects
            recurrences = occurrenceIds.length ?
                occurrenceIds.map( this.getOccurrenceForRecurrenceId, this ) :
                null;
        }

        return recurrences;
    },

    // Exceptions changing the date/time of an occurrence are ignored: the
    // *original* date/time is still included in the allStartDates array.
    allStartDates: function () {
        var recurrenceRule = this.get( 'recurrenceRule' );
        var recurrenceOverrides = this.get( 'recurrenceOverrides' );
        var start = this.get( 'start' );
        var dates, occurrencesSet, id;

        if ( recurrenceRule &&
                !recurrenceRule.until && !recurrenceRule.count ) {
            return [ start ];
        }
        if ( recurrenceRule ) {
            dates = recurrenceRule.getOccurrences( start, null, null );
        } else {
            dates = [ start ];
        }
        if ( recurrenceOverrides ) {
            occurrencesSet = dates.reduce( function ( set, date ) {
                set[ date.toJSON() ] = true;
                return set;
            }, {} );
            for ( id in recurrenceOverrides ) {
                // Remove EXDATEs.
                if ( recurrenceOverrides[ id ].excluded ) {
                    delete occurrencesSet[ id ];
                }
                // Add RDATEs.
                else {
                    occurrencesSet[ id ] = true;
                }
            }
            dates = Object.keys( occurrencesSet ).map( Date.fromJSON );
            dates.sort( numerically );
        }
        return dates;
    }.property( 'start', 'recurrenceRule', 'recurrenceOverrides' ),

    totalOccurrences: function () {
        var recurrenceRule = this.get( 'recurrenceRule' );
        var recurrenceOverrides = this.get( 'recurrenceOverrides' );
        if ( !recurrenceRule && !recurrenceOverrides ) {
            return 1;
        }
        if ( recurrenceRule &&
                !recurrenceRule.count && !recurrenceRule.until ) {
            return Number.MAX_VALUE;
        }
        return this.get( 'allStartDates' ).length;
    }.property( 'allStartDates' ),

    _clearOccurrencesCache: function () {
        var cache = this._ocache;
        var id;
        if ( cache ) {
            for ( id in cache ) {
                cache[ id ].unload();
            }
            this._ocache = null;
        }
    }.observes( 'start', 'timeZone', 'recurrence' ),

    _notifyOccurrencesOfPropertyChange: function ( _, key ) {
        var cache = this._ocache;
        var id;
        if ( cache ) {
            for ( id in cache ) {
                cache[ id ].propertyDidChange( key );
            }
        }
    }.observes( 'calendar', 'uid', 'relatedTo', 'prodId', 'isAllDay',
        'allStartDates', 'totalOccurrences', 'replyTo', 'participantId' ),

    // --- Scheduling

    // priority: attr( Number, {
    //     defaultValue: 0,
    // }),

    scheduleStatus: attr( String, {
        key: 'status',
        defaultValue: 'confirmed',
    }),

    freeBusyStatus: attr( String, {
        defaultValue: 'busy',
    }),

    replyTo: attr( Object, {
        defaultValue: null,
    }),

    participants: attr( Object, {
        defaultValue: null,
        willSet: function ( propValue, propKey, record ) {
            record._removeInvalidPatches();
            return true;
        },
    }),

    participantNameAndEmails: function () {
        var participants = this.get( 'participants' );
        return participants ?
            Object.values( participants )
                .map( toNameAndEmail )
                .join( ', ' ) :
            '';
    }.property( 'participants' ),

    ownerNameAndEmails: function () {
        var participants = this.get( 'participants' );
        return participants ?
            Object.values( participants )
                .filter( isOwner )
                .map( toNameAndEmail )
                .join( ', ' ) :
            '';
    }.property( 'participants' ),

    // --- JMAP Scheduling

    // The id for the calendar owner's participant
    participantId: attr( String, {
        defaultValue: null,
    }),

    rsvp: function ( rsvp ) {
        var participants = this.get( 'participants' );
        var participantId = this.get( 'participantId' );
        var you = ( participants && participantId &&
            participants[ participantId ] ) || null;
        if ( you && rsvp !== undefined ) {
            participants = clone( participants );
            // Don't alert me if I'm not going!
            if ( rsvp === 'declined' ) {
                this.set( 'useDefaultAlerts', false )
                    .set( 'alerts', null );
            }
            // Do alert me if I change my mind!
            else if ( you.participationStatus === 'declined' &&
                    this.get( 'alerts' ) === null ) {
                this.set( 'useDefaultAlerts', true );
            }
            participants[ participantId ].participationStatus = rsvp;
            this.set( 'participants', participants );
        } else {
            rsvp = you && you.participationStatus || '';
        }
        return rsvp;
    }.property( 'participants', 'participantId' ),

    // --- Sharing

    // privacy: attr( String, {
    //     defaultValue: 'public',
    // }),

    // --- Alerts

    useDefaultAlerts: attr( Boolean, {
        defaultValue: false,
    }),

    alerts: attr( Object, {
        defaultValue: null,
        willSet: function ( propValue, propKey, record ) {
            record._removeInvalidPatches();
            return true;
        },
    }),
});
CalendarEvent.__guid__ = 'CalendarEvent';
CalendarEvent.dataGroup = 'urn:ietf:params:jmap:calendars';

// ---

const dayToNumber = RecurrenceRule.dayToNumber;

const byNthThenDay = function ( a, b ) {
    var aNthOfPeriod = a.nthOfPeriod || 0;
    var bNthOfPeriod = b.nthOfPeriod || 0;
    return ( aNthOfPeriod - bNthOfPeriod ) ||
        ( dayToNumber[ a.day ] - dayToNumber[ b.day ] );
};

const numericArrayProps = [ 'byMonthDay', 'byYearDay', 'byWeekNo', 'byHour', 'byMinute', 'bySecond', 'bySetPosition' ];

const normaliseRecurrenceRule = function ( recurrenceRuleJSON ) {
    var byDay, byMonth, i, l, key, value;
    if ( !recurrenceRuleJSON ) {
        return;
    }
    if ( recurrenceRuleJSON.interval === 1 ) {
        delete recurrenceRuleJSON.interval;
    }
    if ( recurrenceRuleJSON.firstDayOfWeek === 'monday' ) {
        delete recurrenceRuleJSON.firstDayOfWeek;
    }
    if (( byDay = recurrenceRuleJSON.byDay )) {
        if ( byDay.length ) {
            byDay.sort( byNthThenDay );
        } else {
            delete recurrenceRuleJSON.byDay;
        }
    }
    if (( byMonth = recurrenceRuleJSON.byMonth )) {
        if ( byMonth.length ) {
            byMonth.sort();
        } else {
            delete recurrenceRuleJSON.byMonth;
        }
    }
    for ( i = 0, l = numericArrayProps.length; i < l; i += 1 ) {
        key = numericArrayProps[i];
        value = recurrenceRuleJSON[ key ];
        if ( value ) {
            // Must be sorted
            if ( value.length ) {
                value.sort( numerically );
            }
            // Must not be empty
            else {
                delete recurrenceRuleJSON[ key ];
            }
        }
    }
};

const mayPatchKey = function ( path/*, original, current*/ ) {
    // We can't patch inside a patch as there's no way to distinguish whether
    // patch { "recurrenceOverrides/2000-01-01T00:00:00/key~1bar": null } is
    // deleting "bar" from the master or deleting the key~1bar patch.
    if ( path.startsWith( 'recurrenceOverrides/' ) ) {
        return false;
    }
    return true;
};

calendar.replaceEvents = {};
calendar.handle( CalendarEvent, {

    precedence: 3,

    fetch: 'CalendarEvent',
    refresh: 'CalendarEvent',

    commit: function ( change ) {
        this.commitType( 'CalendarEvent', change, mayPatchKey );
    },

    // ---

    'CalendarEvent/get': function ( args ) {
        var events = args.list;
        var l = events ? events.length : 0;
        var event, timeZoneId;
        var accountId = args.accountId;
        while ( l-- ) {
            event = events[l];
            timeZoneId = event.timeZone;
            if ( timeZoneId ) {
                calendar.seenTimeZone( TimeZone[ timeZoneId ] );
            }
            normaliseRecurrenceRule( event.recurrenceRule );
        }
        calendar.propertyDidChange( 'usedTimeZones' );
        this.didFetch( CalendarEvent, args, !!this.replaceEvents[ accountId ] );
        this.replaceEvents[ accountId ] = false;
    },

    'CalendarEvent/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( CalendarEvent, args, hasDataForChanged );
        if ( args.hasMoreChanges ) {
            this.fetchMoreChanges( args.accountId, CalendarEvent );
        }
    },

    'CalendarEvent/copy': function ( args, _, reqArgs ) {
        this.didCopy( CalendarEvent, args, reqArgs );
    },

    'error_CalendarEvent/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var accountId = reqArgs.accountId;
        calendar.flushCache( accountId );
    },

    'CalendarEvent/set': function ( args ) {
        this.didCommit( CalendarEvent, args );
    },
});

// --- Export

JMAP.CalendarEvent = CalendarEvent;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: CalendarEventOccurrence.js                                           \\
// Module: CalendarModel                                                      \\
// Requires: CalendarEvent.js                                                 \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP, undefined ) {

const bind = O.bind;
const meta = O.meta;
const clone = O.clone;
const isEqual = O.isEqual;
const TimeZone = O.TimeZone;
const Class = O.Class;
const Obj = O.Object;

const applyPatch = JMAP.Connection.applyPatch;
const makePatches = JMAP.Connection.makePatches;
const CalendarEvent = JMAP.CalendarEvent;
const Duration = JMAP.Duration;

// ---

const mayPatch = {
    links: true,
    translations: true,
    locations: true,
    participants: true,
    alerts: true,
};

const proxyOverrideAttibute = function ( Type, key, attrKey ) {
    return function ( value ) {
        var original = this.get( 'original' );
        var originalValue = this.getOriginalForKey( key );
        var id = this.id;
        var recurrenceOverrides, recurrenceRule;
        var overrides, keepOverride, path;

        if ( !attrKey ) {
            attrKey = key;
        }

        if ( value !== undefined ) {
            // Get current overrides for occurrence
            recurrenceOverrides =
                clone( original.get( 'recurrenceOverrides' ) ) || {};
            overrides = recurrenceOverrides[ id ] ||
                ( recurrenceOverrides[ id ] = {} );

            // Clear any previous overrides for this key
            keepOverride = false;
            for ( path in overrides ) {
                if ( path.indexOf( attrKey ) === 0 ) {
                    delete overrides[ path ];
                } else {
                    keepOverride = true;
                }
            }
            // Set if different to parent
            if ( mayPatch[ attrKey ] ) {
                keepOverride =
                    makePatches( attrKey, overrides, originalValue, value ) ||
                    keepOverride;
            } else if ( !isEqual( originalValue, value ) ) {
                keepOverride = true;
                overrides[ attrKey ] = value && value.toJSON ?
                    value.toJSON() : value;
            }

            // Check if we still have any overrides
            if ( !keepOverride ) {
                // Check if matches recurrence rule. If not, keep.
                recurrenceRule = original.get( 'recurrenceRule' );
                if ( recurrenceRule &&
                        recurrenceRule.matches(
                            original.get( 'start' ), this._start
                        )) {
                    delete recurrenceOverrides[ id ];
                }
            }
            if ( !Object.keys( recurrenceOverrides ).length ) {
                recurrenceOverrides = null;
            }

            // Set on original
            original.set( 'recurrenceOverrides', recurrenceOverrides );
        } else {
            overrides = this.get( 'overrides' );
            if ( attrKey in overrides ) {
                return Type.fromJSON ?
                    Type.fromJSON( overrides[ attrKey ] ) :
                    overrides[ attrKey ];
            }
            value = originalValue;
            if ( value && mayPatch[ attrKey ] ) {
                for ( path in overrides ) {
                    if ( path.indexOf( attrKey ) === 0 ) {
                        if ( value === originalValue ) {
                            value = clone( originalValue );
                        }
                        applyPatch(
                            value,
                            path.slice( attrKey.length + 1 ),
                            overrides[ path ]
                        );
                    }
                }
            }
        }
        return value;
    }.property( 'overrides', 'original.' + key ).doNotNotify();
};

const proxyAttribute = function ( _, key ) {
    return this.get( 'original' ).get( key );
}.property().nocache();

const CalendarEventOccurrence = Class({

    Extends: Obj,

    constructor: CalendarEvent,

    isDragging: false,
    isOccurrence: true,

    isEditable: CalendarEvent.prototype.isEditable,
    isInvitation: CalendarEvent.prototype.isInvitation,

    overrides: bind( null, 'original*recurrenceOverrides',
    function ( recurrenceOverrides ) {
        var id = this.toObject.id;
        return recurrenceOverrides && recurrenceOverrides[ id ] || {};
    }),

    init: function ( original, id ) {
        this._start = Date.fromJSON( id );

        this.id = id;
        this.original = original;
        // For attachment upload only
        this.store = original.get( 'store' );
        this.storeKey = original.get( 'storeKey' ) + id;

        CalendarEventOccurrence.parent.constructor.call( this );
        original.on( 'viewAction', this, 'echoEvent' );
    },

    getOriginalForKey: function ( key ) {
        if ( key === 'start' ) {
            return this._start;
        }
        return this.get( 'original' ).get( key );
    },

    getDoppelganger: function ( store ) {
        var original = this.get( 'original' );
        var originalStore = original.get( 'store' );
        if ( originalStore === store ) {
            return this;
        }
        return original.getDoppelganger( store )
                       .getOccurrenceForRecurrenceId( this.id );
    },

    clone: function ( store ) {
        var clone = CalendarEvent.prototype.clone.call( this, store );
        return clone.set( 'recurrenceRule', null );
    },

    destroy: function () {
        var original = this.get( 'original' );
        var recurrenceOverrides = original.get( 'recurrenceOverrides' );

        recurrenceOverrides = recurrenceOverrides ?
            clone( recurrenceOverrides ) : {};
        recurrenceOverrides[ this.id ] = { excluded: true };
        original.set( 'recurrenceOverrides', recurrenceOverrides );

        this.unload();
    },

    unload: function () {
        this.get( 'original' ).off( 'viewAction', this, 'echoEvent' );
        CalendarEventOccurrence.parent.destroy.call( this );
    },

    is: function ( status ) {
        return this.get( 'original' ).is( status );
    },

    echoEvent: function ( event ) {
        this.fire( event.type, event );
    },

    // ---

    // May not edit calendar prop.
    calendar: proxyAttribute,

    '@type': 'jsevent',
    uid: proxyAttribute,
    relatedTo: proxyAttribute,
    prodId: proxyAttribute,

    created: proxyOverrideAttibute( Date, 'created' ),
    updated: proxyOverrideAttibute( Date, 'updated' ),
    sequence: proxyOverrideAttibute( Number, 'sequence' ),

    // ---

    title: proxyOverrideAttibute( String, 'title' ),
    description: proxyOverrideAttibute( String, 'description' ),

    // ---

    locations: proxyOverrideAttibute( Object, 'locations' ),
    location: CalendarEvent.prototype.location,
    startLocationTimeZone: CalendarEvent.prototype.startLocationTimeZone,
    endLocationTimeZone: CalendarEvent.prototype.endLocationTimeZone,

    // ---

    links: proxyOverrideAttibute( Object, 'links' ),

    // ---

    // locale: attr( String ),
    // localizations: attr( Object ),

    // keywords: attr( Array ),
    // categories: attr( Array ),
    // color: attr( String ),

    // ---

    isAllDay: proxyOverrideAttibute( Boolean, 'isAllDay' ),

    start: proxyOverrideAttibute( Date, 'start' ),
    duration: proxyOverrideAttibute( Duration, 'duration' ),
    timeZone: proxyOverrideAttibute( TimeZone, 'timeZone' ),
    recurrenceRule: proxyAttribute,
    recurrenceOverrides: null,

    getStartInTimeZone: CalendarEvent.prototype.getStartInTimeZone,
    getEndInTimeZone: CalendarEvent.prototype.getEndInTimeZone,

    utcStart: CalendarEvent.prototype.utcStart,
    utcEnd: CalendarEvent.prototype.utcEnd,

    end: CalendarEvent.prototype.end,

    removedDates: null,

    allStartDates: proxyAttribute,
    totalOccurrences: proxyAttribute,

    index: function () {
        var start = this.get( 'start' );
        var original = this.get( 'original' );
        return isEqual( start, original.get( 'start' ) ) ? 0 :
            original.get( 'allStartDates' ).binarySearch( this._start );
    }.property().nocache(),

    // ---

    scheduleStatus: proxyOverrideAttibute( String, 'scheduleStatus', 'status' ),
    freeBusyStatus: proxyOverrideAttibute( String, 'freeBusyStatus' ),
    replyTo: proxyAttribute,
    participants: proxyOverrideAttibute( Object, 'participants' ),
    participantNameAndEmails: CalendarEvent.prototype.participantNameAndEmails,
    ownerNameAndEmails: CalendarEvent.prototype.ownerNameAndEmails,
    participantId: proxyAttribute,

    rsvp: function ( rsvp ) {
        var original = this.get( 'original' );
        var recurrenceOverrides = original.get( 'recurrenceOverrides' );
        var id = this.id;
        // If this is an exception from the organizer, RSVP to just this
        // instance, otherwise RSVP to whole series
        if ( recurrenceOverrides && recurrenceOverrides[ id ] &&
                Object.keys( recurrenceOverrides[ id ] ).some(
                function ( key ) {
                    return key !== 'alerts' && key !== 'useDefaultAlerts';
                })) {
            return CalendarEvent.prototype.rsvp.call( this, rsvp );
        }
        if ( rsvp !== undefined ) {
            original.set( 'rsvp', rsvp );
        }
        return original.get( 'rsvp' );
    }.property( 'participants', 'participantId' ),

    // ---

    useDefaultAlerts: proxyOverrideAttibute( Boolean, 'useDefaultAlerts' ),
    alerts: proxyOverrideAttibute( Object, 'alerts' ),
});

meta( CalendarEventOccurrence.prototype ).attrs =
    meta( CalendarEvent.prototype ).attrs;

// --- Export

JMAP.CalendarEventOccurrence = CalendarEventOccurrence;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: InfiniteDateSource.js                                                \\
// Module: CalendarModel                                                      \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Class = O.Class;
const ObservableArray = O.ObservableArray;

// ---

const InfiniteDateSource = Class({

    Extends: ObservableArray,

    init: function ( mixin ) {
        InfiniteDateSource.parent.constructor.call( this, null, mixin );
        this.windowLengthDidChange();
    },

    start: new Date(),

    getNext: function ( date ) {
        return new Date( date ).add( 1 );
    },

    getPrev: function ( date ) {
        return new Date( date ).subtract( 1 );
    },

    windowLength: 10,

    windowLengthDidChange: function () {
        var windowLength = this.get( 'windowLength' );
        var length = this.get( 'length' );
        var anchor, array, i;
        if ( length < windowLength ) {
            anchor = this.last();
            array = this._array;
            for ( i = length; i < windowLength; i += 1 ) {
                anchor = anchor ?
                    this.getNext( anchor ) :
                    new Date( this.get( 'start' ) );
                if ( anchor ) {
                    array[i] = anchor;
                } else {
                    windowLength = i;
                    break;
                }
            }
            this.rangeDidChange( length, windowLength );
        }
        this.set( 'length', windowLength );
    }.observes( 'windowLength' ),

    shiftWindow: function ( offset ) {
        var current = this.get( '[]' );
        var length = this.get( 'windowLength' );
        var didShift = false;
        var anchor;
        if ( offset < 0 ) {
            anchor = current[0];
            while ( offset++ ) {
                anchor = this.getPrev( anchor );
                if ( !anchor ) {
                    break;
                }
                didShift = true;
                current.unshift( anchor );
            }
            if ( didShift ) {
                current = current.slice( 0, length );
            }
        } else {
            anchor = current.last();
            while ( offset-- ) {
                anchor = this.getNext( anchor );
                if ( !anchor ) {
                    break;
                }
                didShift = true;
                current.push( anchor );
            }
            if ( didShift ) {
                current = current.slice( -length );
            }
        }
        if ( didShift ) {
            this.set( '[]', current );
        }
        return didShift;
    },
});

// --- Export

JMAP.InfiniteDateSource = InfiniteDateSource;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: calendar-model.js                                                    \\
// Module: CalendarModel                                                      \\
// Requires: API, Calendar.js, CalendarEvent.js, RecurrenceRule.js            \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const clone = O.clone;
const guid = O.guid;
const mixin = O.mixin;
const Class = O.Class;
const Obj = O.Object;
const ObservableArray = O.ObservableArray;
const NestedStore = O.NestedStore;
const StoreUndoManager = O.StoreUndoManager;

const auth = JMAP.auth;
const store = JMAP.store;
const calendar = JMAP.calendar;
const Calendar = JMAP.Calendar;
const CalendarEvent = JMAP.CalendarEvent;
const RecurrenceRule = JMAP.RecurrenceRule;
const CALENDARS_DATA = auth.CALENDARS_DATA;

// ---

const TIMED_OR_ALL_DAY = 0;
const ONLY_ALL_DAY = 1;
const ONLY_TIMED = -1;

// ---

const nonRepeatingEvents = new Obj({

    index: null,

    clearIndex: function () {
        this.index = null;
    },

    buildIndex: function () {
        var index = this.index = {};
        var timeZone = calendar.get( 'timeZone' );
        var storeKeys = store.findAll( CalendarEvent, function ( data ) {
            return !data.recurrenceRule && !data.recurrenceOverrides;
        });
        var i = 0;
        var l = storeKeys.length;
        var event, timestamp, end, events;
        for ( ; i < l; i += 1 ) {
            event = store.materialiseRecord( storeKeys[i] );
            timestamp = +event.getStartInTimeZone( timeZone );
            timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
            end = +event.getEndInTimeZone( timeZone );
            do {
                events = index[ timestamp ] || ( index[ timestamp ] = [] );
                events.push( event );
                timestamp += ( 24 * 60 * 60 * 1000 );
            } while ( timestamp < end );
        }
        return this;
    },

    getEventsForDate: function ( date ) {
        var timestamp = +date;
        timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
        if ( !this.index ) {
            this.buildIndex();
        }
        return this.index[ timestamp ] || null;
    },
});

const repeatingEvents = new Obj({

    start: null,
    end: null,
    index: null,

    records: function () {
        var storeKeys = store.findAll( CalendarEvent, function ( data ) {
            return !!data.recurrenceRule || !!data.recurrenceOverrides;
        });
        var i = 0;
        var l = storeKeys.length;
        var records = new Array( l );
        for ( ; i < l; i += 1 ) {
            records[i] = store.materialiseRecord( storeKeys[i] );
        }
        return records;
    }.property(),

    clearIndex: function () {
        this.computedPropertyDidChange( 'records' );
        this.start = null;
        this.end = null;
        this.index = null;
    },

    buildIndex: function ( start, end ) {
        var index = this.index || ( this.index = {} );
        var startIndexStamp = +start;
        var endIndexStamp = +end;
        var timeZone = calendar.get( 'timeZone' );
        var records = this.get( 'records' );
        var i = 0;
        var l = records.length;
        var event, occurs, j, ll, occurrence, timestamp, endStamp, events;

        while ( i < l ) {
            event = records[i];
            occurs = event
                .getOccurrencesThatMayBeInDateRange( start, end, timeZone );
            for ( j = 0, ll = occurs ? occurs.length : 0; j < ll; j += 1 ) {
                occurrence = occurs[j];
                timestamp = +occurrence.getStartInTimeZone( timeZone );
                timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
                // If starts after end of range being added to index, ignore
                if ( timestamp >= endIndexStamp ) {
                    continue;
                }
                endStamp = +occurrence.getEndInTimeZone( timeZone );
                // If ends before start of range being added to index, ignore
                if ( endStamp < startIndexStamp ) {
                    continue;
                }
                // Only add to days within index range
                timestamp = Math.max( startIndexStamp, timestamp );
                endStamp = Math.min( endIndexStamp, endStamp );
                do {
                    events = index[ timestamp ] || ( index[ timestamp ] = [] );
                    events.push( occurrence );
                    timestamp += ( 24 * 60 * 60 * 1000 );
                } while ( timestamp < endStamp );
            }
            i += 1;
        }
        return this;
    },

    getEventsForDate: function ( date ) {
        var start = this.start;
        var end = this.end;
        var timestamp = +date;
        timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
        if ( !this.index ) {
            start = this.start = new Date( date ).subtract( 60 );
            end = this.end = new Date( date ).add( 120 );
            this.buildIndex( start, end );
        } else if ( date < start ) {
            end = start;
            start = this.start = new Date( date ).subtract( 120 );
            this.buildIndex( start, end );
        } else if ( date >= this.end ) {
            start = end;
            end = this.end = new Date( date ).add( 120 );
            this.buildIndex( start, end );
        }
        return this.index[ timestamp ] || null;
    },
});

// ---

/*
    If time zone is null -> consider each event in its native time zone.
    Otherwise, consider each event in the time zone given.

    date     - {Date} The date.
*/
const NO_EVENTS = [];
const eventSources = [ nonRepeatingEvents, repeatingEvents ];
const sortByStartInTimeZone = function ( timeZone ) {
    return function ( a, b ) {
        var aStart = a.getStartInTimeZone( timeZone );
        var bStart = b.getStartInTimeZone( timeZone );
        return aStart < bStart ? -1 : aStart > bStart ? 1 :
            a.get( 'uid' ) < b.get( 'uid' ) ? -1 : 1;
    };
};

const findEventsForDate = function ( date, allDay, filter ) {
    var l = eventSources.length;
    var timeZone = calendar.get( 'timeZone' );
    var i, results, events, showDeclined;
    for ( i = 0; i < l; i += 1 ) {
        events = eventSources[i].getEventsForDate( date );
        if ( events ) {
            results = results ? results.concat( events ) : events;
        }
    }

    if ( results ) {
        showDeclined = calendar.get( 'showDeclined' );

        // Filter out all-day and invisible calendars.
        results = results.filter( function ( event ) {
            return event.get( 'calendar' ).get( 'isEventsShown' ) &&
                ( showDeclined || event.get( 'rsvp' ) !== 'declined' ) &&
                ( !allDay || event.get( 'isAllDay' ) === ( allDay > 0 ) ) &&
                ( !filter || filter( event ) );
        });

        // And sort
        if ( results.length ) {
            results.sort( sortByStartInTimeZone( timeZone ) );
        } else {
            results = null;
        }
    }

    return results || NO_EVENTS;
};

// ---

const indexObservers = {};

const EventsList = Class({

    Extends: ObservableArray,

    init: function ( date, allDay, where ) {
        this.date = date;
        this.allDay = allDay;
        this.where = where;

        indexObservers[ guid( this ) ] = this;

        EventsList.parent.constructor.call( this,
            findEventsForDate( date, allDay, where ) );
    },

    destroy: function () {
        delete indexObservers[ guid( this ) ];
        EventsList.parent.destroy.call( this );
    },

    recalculate: function () {
        return this.set( '[]',
            findEventsForDate( this.date, this.allDay, this.where ) );
    },
});

// ---

const toUTCDay = function ( date ) {
    return new Date( date - ( date % ( 24 * 60 * 60 * 1000 ) ) );
};

const twelveWeeks = 12 * 7 * 24 * 60 * 60 * 1000;
const now = new Date();
const usedTimeZones = {};
var editStore;

mixin( calendar, {

    editStore: editStore = new NestedStore( store ),

    undoManager: new StoreUndoManager({
        store: editStore,
        maxUndoCount: 10
    }),

    /*  Issues with splitting:
        1. If split on an inclusion, the start date of the new recurrence
           may not match the recurrence, which can cause incorrect expansion
           for the future events.
        2. If the event has date-altering exceptions, these are ignored for
           the purposes of splitting.
    */
    splitEventAtOccurrence: function ( occurrence ) {
        var event = occurrence.get( 'original' );

        var recurrenceRule = event.get( 'recurrenceRule' );
        var recurrenceOverrides = event.get( 'recurrenceOverrides' );
        var recurrenceJSON = recurrenceRule ? recurrenceRule.toJSON() : null;
        var isFinite = !recurrenceRule ||
                !!( recurrenceRule.count || recurrenceRule.until );

        var allStartDates = event.get( 'allStartDates' );
        var occurrenceIndex = occurrence.get( 'index' );
        var occurrenceTotal = allStartDates.length;
        var isLast = isFinite && ( occurrenceIndex + 1 === occurrenceTotal );

        var startJSON = occurrence.get( 'id' );
        var start = Date.fromJSON( startJSON );

        var hasOverridesPast = false;
        var hasOverridesFuture = false;

        var pastRelatedTo, futureRelatedTo, uidOfFirst;
        var recurrenceOverridesPast, recurrenceOverridesFuture;
        var date;
        var toEditEvent;

        if ( !occurrenceIndex ) {
            return event;
        }

        // Duplicate original event
        event = event.getDoppelganger( editStore );
        if ( isLast ) {
            toEditEvent = occurrence.clone( editStore );
        } else {
            toEditEvent = event.clone( editStore )
                .set( 'start', occurrence.getOriginalForKey( 'start' ) );
        }

        // Set first/next relatedTo pointers
        pastRelatedTo = event.get( 'relatedTo' );
        uidOfFirst = pastRelatedTo &&
            Object.keys( pastRelatedTo ).find( function ( uid ) {
                return pastRelatedTo[ uid ].relation.first;
            }) ||
            event.get( 'uid' );

        futureRelatedTo = {};
        futureRelatedTo[ uidOfFirst ] = {
            '@type': 'Relation',
            relation: { first: true },
        };
        pastRelatedTo = pastRelatedTo ? clone( pastRelatedTo ) : {};
        pastRelatedTo[ toEditEvent.get( 'uid' ) ] = {
            '@type': 'Relation',
            relation: { next: true },
        };
        toEditEvent.set( 'relatedTo', futureRelatedTo );
        event.set( 'relatedTo',  pastRelatedTo );

        // Modify original recurrence start or end
        if ( isFinite && recurrenceRule && !recurrenceOverrides ) {
            if ( occurrenceIndex === 1 ) {
                event.set( 'recurrenceRule', null );
            } else {
                event.set( 'recurrenceRule',
                    RecurrenceRule.fromJSON( Object.assign( {}, recurrenceJSON,
                    recurrenceJSON.until ? {
                        until: allStartDates[ occurrenceIndex - 1 ].toJSON()
                    } : {
                        count: occurrenceIndex
                    }))
                );
            }
        } else if ( recurrenceRule ) {
            event.set( 'recurrenceRule',
                RecurrenceRule.fromJSON( Object.assign( {}, recurrenceJSON, {
                    count: null,
                    until: new Date( start - ( 24 * 60 * 60 * 1000 ) ).toJSON()
                }))
            );
        }

        // Set recurrence for new event
        if ( !isLast && recurrenceRule ) {
            if ( recurrenceJSON.count ) {
                toEditEvent.set( 'recurrenceRule',
                    RecurrenceRule.fromJSON( Object.assign( {}, recurrenceJSON,
                    // If there are RDATEs beyond the final normal
                    // occurrence this may result in extra events being added
                    // by the split. Left as a known issue for now.
                    recurrenceOverrides ? {
                        count: null,
                        until: allStartDates.last().toJSON()
                    } : {
                        count: occurrenceTotal - occurrenceIndex,
                        until: null
                    }))
                );
            } else {
                toEditEvent.set( 'recurrenceRule', recurrenceRule );
            }
        }

        // Split overrides
        if ( recurrenceOverrides ) {
            recurrenceOverridesPast = {};
            recurrenceOverridesFuture = {};
            for ( date in recurrenceOverrides ) {
                if ( date < startJSON ) {
                    recurrenceOverridesPast[ date ] =
                        recurrenceOverrides[ date ];
                    hasOverridesPast = true;
                } else {
                    recurrenceOverridesFuture[ date ] =
                        recurrenceOverrides[ date ];
                    hasOverridesFuture = true;
                }
            }
            event.set( 'recurrenceOverrides',
                hasOverridesPast ? recurrenceOverridesPast : null );
            if ( !isLast ) {
                toEditEvent.set( 'recurrenceOverrides',
                    hasOverridesFuture ? recurrenceOverridesFuture : null );
            }
        }

        // Save new event to store
        return toEditEvent.saveToStore();
    },

    // ---

    showDeclined: false,
    timeZone: null,
    usedTimeZones: usedTimeZones,

    eventSources: eventSources,
    repeatingEvents: repeatingEvents,
    nonRepeatingEvents: nonRepeatingEvents,
    indexObservers: indexObservers,

    loadingEventsStart: now,
    loadingEventsEnd: now,
    loadedEventsStart: now,
    loadedEventsEnd: now,

    findEventsForDate: findEventsForDate,

    getEventsForDate: function ( date, allDay, where ) {
        this.loadEvents( date );
        return new EventsList( date, allDay, where || null );
    },

    fetchEventsInRangeForAccount: function ( accountId, after, before ) {
        this.callMethod( 'CalendarEvent/query', {
            accountId: accountId,
            filter: {
                after: after.toJSON() + 'Z',
                before: before.toJSON() + 'Z',
            },
        });
        this.callMethod( 'CalendarEvent/get', {
            accountId: accountId,
            '#ids': {
                resultOf: this.getPreviousMethodId(),
                name: 'CalendarEvent/query',
                path: '/ids',
            },
        });
    },

    fetchEventsInRange: function ( after, before, callback ) {
        var accounts = auth.get( 'accounts' );
        var accountId;
        for ( accountId in accounts ) {
            if ( accounts[ accountId ].accountCapabilities[ CALENDARS_DATA ] ) {
                this.fetchEventsInRangeForAccount( accountId, after, before );
            }
        }
        if ( callback ) {
            this.addCallback( callback );
        }
        return this;
    },

    loadEventsInRange: function ( start, end ) {
        var loadingEventsStart = this.loadingEventsStart;
        var loadingEventsEnd = this.loadingEventsEnd;
        if ( start < loadingEventsStart ) {
            this.fetchEventsInRange( start, loadingEventsStart, function () {
                calendar.set( 'loadedEventsStart', start );
            });
            this.set( 'loadingEventsStart', start );
        }
        if ( end > loadingEventsEnd ) {
            this.fetchEventsInRange( loadingEventsEnd, end, function () {
                calendar.set( 'loadedEventsEnd', end );
            });
            this.set( 'loadingEventsEnd', end );
        }
        return this;
    },

    loadEvents: function ( date ) {
        var loadingEventsStart = this.loadingEventsStart;
        var loadingEventsEnd = this.loadingEventsEnd;
        var start = date;
        var end = date;
        if ( loadingEventsStart === loadingEventsEnd ) {
            start = toUTCDay( date ).subtract( 16, 'week' );
            end = toUTCDay( date ).add( 48, 'week' );
            this.fetchEventsInRange( start, end, function () {
                calendar
                    .set( 'loadedEventsStart', start )
                    .set( 'loadedEventsEnd', end );
            });
            this.set( 'loadingEventsStart', start );
            this.set( 'loadingEventsEnd', end );
            return;
        }
        if ( date < +loadingEventsStart + twelveWeeks ) {
            start = toUTCDay( date < loadingEventsStart ?
                date : loadingEventsStart
            ).subtract( 24, 'week' );
        }
        if ( date > +loadingEventsEnd - twelveWeeks ) {
            end = toUTCDay( date > loadingEventsEnd ?
                date : loadingEventsEnd
            ).add( 24, 'week' );
        }
        return this.loadEventsInRange( start, end );
    },

    clearIndexes: function () {
        nonRepeatingEvents.clearIndex();
        repeatingEvents.clearIndex();
        this.recalculate();
    }.observes( 'timeZone' ),

    recalculate: function () {
        Object.values( indexObservers ).forEach( function ( eventsList ) {
            eventsList.recalculate();
        });
    }.queue( 'before' ).observes( 'showDeclined' ),

    flushCache: function ( accountId ) {
        this.replaceEvents[ accountId ] = true;
        this.fetchEventsInRangeForAccount( accountId,
            this.loadedEventsStart, this.loadedEventsEnd );
    },

    // ---

    seenTimeZone: function ( timeZone ) {
        if ( timeZone ) {
            var timeZoneId = timeZone.id;
            usedTimeZones[ timeZoneId ] =
                ( usedTimeZones[ timeZoneId ] || 0 ) + 1;
        }
        return this;
    },

    // ---

    NO_EVENTS: NO_EVENTS,

    TIMED_OR_ALL_DAY: TIMED_OR_ALL_DAY,
    ONLY_ALL_DAY: ONLY_ALL_DAY,
    ONLY_TIMED: ONLY_TIMED,
});
store.on( Calendar, calendar, 'recalculate' )
     .on( CalendarEvent, calendar, 'clearIndexes' );

calendar.handle( null, {
    'CalendarEvent/query': function () {
        // We don't care about the list, we only use it to fetch the
        // events we want. This may change with search in the future!
    },
});

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: NonEmptyDateSource.js                                                \\
// Module: CalendarModel                                                      \\
// Requires: InfiniteDateSource.js, calendar-model.js                         \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const guid = O.guid;
const Class = O.Class;
const ObservableArray = O.ObservableArray;

const calendar = JMAP.calendar;
const indexObservers = calendar.indexObservers;
const findEventsForDate = calendar.findEventsForDate;
const NO_EVENTS = calendar.NO_EVENTS;
const TIMED_OR_ALL_DAY = calendar.TIMED_OR_ALL_DAY;
const InfiniteDateSource = JMAP.InfiniteDateSource;

// ---

const SlaveEventsList = Class({

    Extends: ObservableArray,

    init: function ( date, source, initialArray ) {
        this.date = date;
        this.source = source;
        source.eventsLists[ guid( this ) ] = this;

        SlaveEventsList.parent.constructor.call( this, initialArray );
    },

    destroy: function () {
        delete this.source.eventsLists[ guid( this ) ];
        SlaveEventsList.parent.destroy.call( this );
    },
});

// ---

const returnTrue = function (/* event */) {
    return true;
};

// ---

const NonEmptyDateSource = Class({

    Extends: InfiniteDateSource,

    init: function () {
        this.where = returnTrue;
        this.index = {};
        this.eventsLists = {};
        this.allDay = TIMED_OR_ALL_DAY;
        NonEmptyDateSource.parent.init.apply( this, arguments );
        indexObservers[ guid( this ) ] = this;
    },

    destroy: function () {
        delete indexObservers[ guid( this ) ];
        NonEmptyDateSource.parent.destroy.call( this );
    },

    getNext: function ( date ) {
        var start = this.get( 'start' );
        var next = this.getDelta( date, 1 );
        if ( date < start && ( !next || next > start ) ) {
            return new Date( start );
        }
        return next;
    },

    getPrev: function ( date ) {
        var start = this.get( 'start' );
        var prev = this.getDelta( date, -1 );
        if ( date > start && ( !prev || prev < start ) ) {
            return new Date( start );
        }
        return prev;
    },

    getDelta: function ( date, deltaDays ) {
        var start = calendar.get( 'loadedEventsStart' );
        var end = calendar.get( 'loadedEventsEnd' );
        var allDay = this.get( 'allDay' );
        var where = this.get( 'where' );
        var events = NO_EVENTS;
        var index = this.index;
        var timestamp;
        date = new Date( date );
        do {
            date = date.add( deltaDays, 'day' );
            // Check we're within our bounds
            if ( date < start || end <= date ) {
                return null;
            }
            timestamp = +date;
            events = index[ timestamp ] ||
                findEventsForDate( date, allDay, where );
            index[ timestamp ] = events;
        } while ( events === NO_EVENTS );

        return date;
    },

    getEventsForDate: function ( date ) {
        var index = this.index;
        var timestamp = +date;
        return new SlaveEventsList( date, this,
            index[ timestamp ] ||
            ( index[ timestamp ] = findEventsForDate(
                date, this.get( 'allDay' ), this.get( 'where' ) ) )
        );
    },

    recalculate: function () {
        var allDay = this.get( 'allDay' );
        var where = this.get( 'where' );
        var start = this.get( 'start' );
        var first = this.first() || start;
        var index = this.index = {};
        var eventsLists = this.eventsLists;
        var id, list, date;
        for ( id in eventsLists ) {
            list = eventsLists[ id ];
            date = list.date;
            list.set( '[]',
                index[ +date ] = findEventsForDate( date, allDay, where )
            );
        }

        this.set( '[]', [
            this.getNext( new Date( first ).add( -1, 'day' ) ) ||
            new Date( start )
        ]).windowLengthDidChange();
    }.observes( 'where' ),
});

// --- Export

JMAP.NonEmptyDateSource = NonEmptyDateSource;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: AmbiguousDate.js                                                     \\
// Module: ContactsModel                                                      \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const i18n = O.i18n;

// ---

class AmbiguousDate {
    constructor ( day, month, year ) {
        this.day = day || 0;
        this.month = month || 0;
        this.year = year || 0;
    }

    toJSON () {
        return "%'04n-%'02n-%'02n".format(
            this.year, this.month, this.day );
    }

    hasValue () {
        return !!( this.day || this.month || this.year );
    }

    yearsAgo () {
        if ( !this.year ) { return -1; }
        var now = new Date(),
            ago = now.getFullYear() - this.year,
            nowMonth = now.getMonth(),
            month = ( this.month || 1 ) - 1;
        if ( month > nowMonth ||
                ( month === nowMonth && this.day > now.getDate() ) ) {
            ago -= 1;
        }
        return ago;
    }

    prettyPrint () {
        var day = this.day,
            month = this.month,
            year = this.year,
            dateElementOrder = i18n.get( 'dateElementOrder' ),
            dayString = day ?
                day + ( year && dateElementOrder === 'mdy' ? ', ' : ' ' ) : '',
            monthString = month ?
                i18n.get( 'monthNames' )[ month - 1 ] + ' ' : '',
            yearString = year ? year + ' '  : '';

        return (
            dateElementOrder === 'mdy' ?
                ( monthString + dayString + yearString ) :
            dateElementOrder === 'ymd' ?
                ( yearString + monthString + dayString ) :
                ( dayString + monthString + yearString )
        ).trim();
    }

    static fromJSON ( json ) {
        var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec( json || '' );
        return parts ?
            new AmbiguousDate( +parts[3], +parts[2], +parts[1] ) : null;
    }
}

JMAP.AmbiguousDate = AmbiguousDate;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Contact.js                                                           \\
// Module: ContactsModel                                                      \\
// Requires: API, AmbiguousDate.js                                            \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP, undefined ) {

const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;
const sortByProperties = O.sortByProperties;

const auth = JMAP.auth;
const contacts = JMAP.contacts;
const AmbiguousDate = JMAP.AmbiguousDate;

// ---

const Contact = Class({

    Extends: Record,

    uid: attr( String ),

    avatar: attr( Object, {
        defaultValue: null,
    }),

    prefix: attr( String, {
        defaultValue: '',
    }),
    firstName: attr( String, {
        defaultValue: '',
    }),
    lastName: attr( String, {
        defaultValue: '',
    }),
    suffix: attr( String, {
        defaultValue: '',
    }),

    nickname: attr( String, {
        defaultValue: '',
    }),

    birthday: attr( AmbiguousDate, {
        defaultValue: '0000-00-00',
    }),
    anniversary: attr( AmbiguousDate, {
        defaultValue: '0000-00-00',
    }),

    company: attr( String, {
        defaultValue: '',
    }),
    department: attr( String, {
        defaultValue: '',
    }),
    jobTitle: attr( String, {
        defaultValue: '',
    }),

    emails: attr( Array, {
        defaultValue: [],
    }),
    phones: attr( Array, {
        defaultValue: [],
    }),
    online: attr( Array, {
        defaultValue: [],
    }),

    addresses: attr( Array, {
        defaultValue: [],
    }),

    notes: attr( String, {
        defaultValue: '',
    }),

    isEditable: function () {
        var accountId = this.get( 'accountId' );
        return !accountId ||
            !auth.get( 'accounts' )[ accountId ].isReadOnly;
    }.property( 'accountId' ),

    // ---

    groups: function () {
        var contact = this;
        return contact
            .get( 'store' )
            .getAll( JMAP.ContactGroup, null, sortByProperties([ 'name' ]) )
            .filter( function ( group ) {
                return group.contains( contact );
           });
    }.property(),

    groupsDidChange: function () {
        this.computedPropertyDidChange( 'groups' );
    },

    // ---

    init: function () {
        Contact.parent.init.apply( this, arguments );
        this.get( 'store' ).on( JMAP.ContactGroup, this, 'groupsDidChange' );
    },

    storeWillUnload: function () {
        this.get( 'store' ).off( JMAP.ContactGroup, this, 'groupsDidChange' );
        Contact.parent.storeWillUnload.call( this );
    },

    // Destroy dependent records.
    destroy: function () {
        this.get( 'groups' ).forEach( function ( group ) {
            group.removeContact( this );
        }, this );
        Contact.parent.destroy.call( this );
    },

    // ---

    name: function ( name ) {
        if ( name !== undefined ) {
            name = name ? name.trim() : '';
            var space = name.lastIndexOf( ' ' );
            this.set( 'firstName', space > -1 ?
                    name.slice( 0, space ) : name )
                .set( 'lastName', space > -1 ?
                    name.slice( space + 1 ) : '' );
        } else {
            name = (
                this.get( 'firstName' ) + ' ' + this.get( 'lastName' )
            ).trim() || this.get( 'company' );
        }
        return name;
    }.property( 'firstName', 'lastName', 'company' ),

    emailName: function () {
        var name = this.get( 'name' );
        // Need to quote unless only using atext characters
        // https://tools.ietf.org/html/rfc5322#section-3.2.3
        if ( !/^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]*$/.test( name ) ) {
            name = JSON.stringify( name );
        }
        return name;
    }.property( 'name' ),

    defaultEmailIndex: function () {
        var emails = this.get( 'emails' );
        var i, l;
        for ( i = 0, l = emails.length; i < l; i += 1 ) {
            if ( emails[i].isDefault ) {
                return i;
            }
        }
        return 0;
    }.property( 'emails' ),

    defaultEmail: function () {
        var email = this.get( 'emails' )[ this.get( 'defaultEmailIndex' ) ];
        return email ? email.value : '';
    }.property( 'emails' ),

    defaultNameAndEmail: function () {
        var name = this.get( 'emailName' );
        var email = this.get( 'defaultEmail' );
        return email ? name ? name + ' <' + email + '>' : email : '';
    }.property( 'emailName', 'defaultEmail' ),
});
Contact.__guid__ = 'Contact';
Contact.dataGroup = 'urn:ietf:params:jmap:contacts';

// ---

contacts.handle( Contact, {

    precedence: 0, // Before ContactGroup

    fetch: 'Contact',
    refresh: 'Contact',
    commit: 'Contact',

    // ---

    'Contact/get': function ( args, reqMethod, reqArgs ) {
        const isAll = ( reqArgs.ids === null );
        this.didFetch( Contact, args, isAll );
    },

    'Contact/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( Contact, args, hasDataForChanged );
        if ( args.hasMoreChanges ) {
            this.fetchMoreChanges( args.accountId, Contact );
        }
    },

    'Contact/copy': function ( args, _, reqArgs ) {
        this.didCopy( Contact, args, reqArgs );
    },

    'error_Contact/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( accountId, Contact );
    },

    'Contact/set': function ( args ) {
        this.didCommit( Contact, args );
    },
});

// --- Export

JMAP.Contact = Contact;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: ContactGroup.js                                                      \\
// Module: ContactsModel                                                      \\
// Requires: API, Contact.js                                                  \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const loc = O.loc;
const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;
const ValidationError = O.ValidationError;
const REQUIRED = ValidationError.REQUIRED;

const auth = JMAP.auth;
const contacts = JMAP.contacts;
const Contact = JMAP.Contact;

// ---

const ContactGroup = Class({

    Extends: Record,

    isEditable: function () {
        var accountId = this.get( 'accountId' );
        return !accountId ||
            !auth.get( 'accounts' )[ accountId ].isReadOnly;
    }.property( 'accountId' ),

    uid: attr( String ),

    name: attr( String, {
        defaultValue: '',
        validate: function ( propValue/*, propKey, record*/ ) {
            if ( !propValue ) {
                return new ValidationError( REQUIRED,
                    loc( 'S_LABEL_REQUIRED' )
                );
            }
            return null;
        },
    }),

    contacts: Record.toMany({
        recordType: Contact,
        key: 'contactIds',
        isNullable: false,
        defaultValue: [],
        willSet: function () {
            return true;
        },
    }),

    contactIndex: function () {
        var storeKeys = this.contacts.getRaw( this, 'contacts' );
        var index = {};
        var i, l;
        for ( i = 0, l = storeKeys.length; i < l; i += 1 ) {
            index[ storeKeys[i] ] = true;
        }
        return index;
    }.property( 'contacts' ),

    containsStoreKey: function ( storeKey ) {
        return !!this.get( 'contactIndex' )[ storeKey ];
    },

    contains: function ( contact ) {
        return this.containsStoreKey( contact.get( 'storeKey' ) );
    },

    addContact: function ( contact ) {
        this.get( 'contacts' ).add( contact );
        return this;
    },

    removeContact: function ( contact ) {
        this.get( 'contacts' ).remove( contact );
        return this;
    },
});
ContactGroup.__guid__ = 'ContactGroup';
ContactGroup.dataGroup = 'urn:ietf:params:jmap:contacts';

// ---

contacts.handle( ContactGroup, {

    precedence: 1, // After Contact

    fetch: 'ContactGroup',
    refresh: 'ContactGroup',
    commit: 'ContactGroup',

    // ---

    'ContactGroup/get': function ( args, _, reqArgs ) {
        const isAll = ( reqArgs.ids === null );
        this.didFetch( ContactGroup, args, isAll );
    },

    'ContactGroup/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( ContactGroup, args, hasDataForChanged );
    },

    'error_ContactGroup/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( accountId, ContactGroup );
    },

    'ContactGroup/set': function ( args ) {
        this.didCommit( ContactGroup, args );
    },
});

// --- Export

JMAP.ContactGroup = ContactGroup;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: contacts-model.js                                                    \\
// Module: ContactsModel                                                      \\
// Requires: API, Contact.js                                                  \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const loc = O.loc;
const mixin = O.mixin;
const READY = O.Status.READY;
const Obj = O.Object;
const NestedStore = O.NestedStore;
const StoreUndoManager = O.StoreUndoManager;

const Contact = JMAP.Contact;
const ContactGroup = JMAP.ContactGroup;
const auth = JMAP.auth;
const CONTACTS_DATA = JMAP.auth.CONTACTS_DATA;
const store = JMAP.store;
const contacts = JMAP.contacts;

// ---

const contactsIndex = new Obj({
    index: null,
    clearIndex: function () {
        this.index = null;
    },
    buildIndex: function () {
        var index = this.index = {};
        var storeKeys = store.findAll( Contact );
        var i, l, storeKey, emails, ll;
        for ( i = 0, l = storeKeys.length; i < l; i += 1 ) {
            storeKey = storeKeys[i];
            emails = store.getData( storeKey ).emails;
            ll = emails ? emails.length : 0;
            while ( ll-- ) {
                index[ emails[ll].value.toLowerCase() ] = storeKey;
            }
        }
        return index;
    },
    getIndex: function () {
        return this.index || this.buildIndex();
    },
});
store.on( Contact, contactsIndex, 'clearIndex' );

// --- VIPs

const UNCACHED = 0;
const REVALIDATE = 1;
const CACHED = 2;

const vips = new Obj({
    _groupCacheState: UNCACHED,
    _group: null,
    _vipSKs: null,

    recalculate: function () {
        this._groupCacheState = REVALIDATE;
        var group = this.getGroup( store, false );
        var newStoreKeys = group ? group.get( 'contactIndex' ) : {};
        var oldStoreKeys = this._vipSKs || {};
        var changed = [];
        var storeKey;
        for ( storeKey in oldStoreKeys ) {
            if ( !( storeKey in newStoreKeys ) ) {
                changed.push( storeKey );
            }
        }
        for ( storeKey in newStoreKeys ) {
            if ( !( storeKey in oldStoreKeys ) ) {
                changed.push( storeKey );
            }
        }
        this._vipSKs = newStoreKeys;
        if ( changed.length ) {
            changed.forEach( storeKey => {
                // The group may contain non-existent contacts if the contact
                // is shared and deleted by another user. This is actually a
                // feature as if it's undeleted (e.g. the other user made a
                // mistake), all of the other users get it back in their VIPs
                // and don't lose data. However, we shouldn't materialise or
                // fetch it – if it's not in memory we know it's not on the
                // server right now.
                if ( store.getStatus( storeKey ) & READY ) {
                    store.getRecordFromStoreKey( storeKey )
                        .computedPropertyDidChange( 'isVIP' );

                }
            });
            this.fire( 'change' );
        }
    },

    // ---

    getGroup: function ( storeForContact, createIfNotFound ) {
        var group = this._group;
        var groupCacheState = this._groupCacheState;
        var primaryAccountId;
        if ( groupCacheState === CACHED && ( group || !createIfNotFound ) ) {
            // Nothing to do
        } else if ( groupCacheState === REVALIDATE &&
                group && group.is( READY ) ) {
            this._groupCacheState = CACHED;
        } else {
            primaryAccountId = auth.get( 'primaryAccounts' )[ CONTACTS_DATA ];
            group = store.getOne( ContactGroup, data =>
                data.accountId === primaryAccountId &&
                data.uid === 'vips'
            );
            if ( !group && createIfNotFound ) {
                group = new ContactGroup( store )
                    .set( 'name', loc( 'VIPS' ) )
                    .set( 'uid', 'vips' )
                    .saveToStore();
            }
            this._group = group;
            this._groupCacheState = CACHED;
        }
        return group && group.getDoppelganger( storeForContact );
    },

    add: function ( contact ) {
        var group = this.getGroup( contact.get( 'store' ), true );
        group.addContact( contact );
        return this;
    },

    remove: function ( contact ) {
        var group = this.getGroup( contact.get( 'store' ), false );
        if ( group ) {
            group.removeContact( contact );
        }
        return this;
    },

    containsStoreKey: function ( store, storeKey ) {
        var group = this.getGroup( store, false );
        if ( group ) {
            return group.get( 'contactIndex' )[ storeKey ] || false;
        }
        return false;
    },

    contains: function ( contact ) {
        return this.containsStoreKey(
            contact.get( 'store' ),
            contact.get( 'storeKey' )
        );
    },
});
store.on( ContactGroup, vips, 'recalculate' );

mixin( Contact.prototype, {
    isVIP: function ( isVIP ) {
        if ( !this.get( 'storeKey' ) ) {
            return false;
        }
        if ( isVIP !== undefined ) {
            if ( isVIP ) {
                vips.add( this );
            } else {
                vips.remove( this );
            }
        } else {
            isVIP = vips.contains( this );
        }
        return isVIP;
    }.property(),
});

// ---

const editStore = new NestedStore( store );

Object.assign( contacts, {
    editStore: editStore,

    undoManager: new StoreUndoManager({
        store: editStore,
        maxUndoCount: 10,
    }),

    vips: vips,

    getContactFromEmail: function ( email ) {
        var index = contactsIndex.getIndex();
        var storeKey = index[ email.toLowerCase() ];
        return storeKey ? store.getRecordFromStoreKey( storeKey ) : null;
    },
});

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Identity.js                                                          \\
// Module: MailModel                                                          \\
// Requires: API                                                              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;

// ---

const Identity = Class({

    Extends: Record,

    name: attr( String, {
        defaultValue: '',
    }),

    email: attr( String ),

    replyTo: attr( Array, {
        defaultValue: null,
    }),

    bcc: attr( Array, {
        defaultValue: null,
    }),

    textSignature: attr( String, {
        defaultValue: '',
    }),

    htmlSignature: attr( String, {
        defaultValue: '',
    }),

    mayDelete: attr( Boolean, {
        defaultValue: true
    }),

    // ---

    nameAndEmail: function () {
        var name = this.get( 'name' ).replace( /["\\]/g, '' );
        var email = this.get( 'email' );
        if ( name ) {
            // Need to quote unless only using atext characters
            // https://tools.ietf.org/html/rfc5322#section-3.2.3
            if ( !/^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]*$/.test( name ) ) {
                name = JSON.stringify( name );
            }
            return name + ' <' + email + '>';
        }
        return email;
    }.property( 'name', 'email' ),
});
Identity.__guid__ = 'Identity';
Identity.dataGroup = 'urn:ietf:params:jmap:submission';

JMAP.mail.handle( Identity, {

    precedence: 2,

    fetch: 'Identity',
    refresh: 'Identity',
    commit: 'Identity',

    // ---

    'Identity/get': function ( args, reqMethod, reqArgs ) {
        const isAll = ( reqArgs.ids === null );
        this.didFetch( Identity, args, isAll );
    },

    'Identity/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( Identity, args, hasDataForChanged );
        if ( args.hasMoreChanges ) {
            this.fetchMoreChanges( args.accountId, Identity );
        }
    },

    'error_Identity/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( accountId, Identity );
    },

    'Identity/set': function ( args ) {
        this.didCommit( Identity, args );
    },
});

// --- Export

JMAP.Identity = Identity;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Mailbox.js                                                           \\
// Module: MailModel                                                          \\
// Requires: API                                                              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const loc = O.loc;
const i18n = O.i18n;
const Class = O.Class;
const RecordArray = O.RecordArray;
const LocalQuery = O.LocalQuery;
const Record = O.Record;
const attr = Record.attr;
const ValidationError = O.ValidationError;
const REQUIRED = ValidationError.REQUIRED;
const TOO_LONG = ValidationError.TOO_LONG;

const connection = JMAP.mail;
const makeSetRequest = JMAP.Connection.makeSetRequest;

// ---

const roleSortOrder = {
    inbox: 1,
    snoozed: 2,
    archive: 3,
    drafts: 4,
    xtemplates: 5,
    sent: 6,
    junk: 7,
    trash: 8,
    all: 9,
};

const bySortOrderRoleOrName = function ( a, b ) {
    return (
        a.sortOrder - b.sortOrder
    ) || (
        ( roleSortOrder[ a.role ] || 99 ) -
        ( roleSortOrder[ b.role ] || 99 )
    ) || (
        i18n.compare( a.name, b.name )
    ) || (
        a.id < b.id ? -1 : 1
    );
};

const Mailbox = Class({

    Extends: Record,

    name: attr( String, {
        defaultValue: '',
        validate: function ( propValue/*, propKey, record*/ ) {
            if ( !propValue ) {
                return new ValidationError( REQUIRED,
                    loc( 'S_LABEL_REQUIRED' )
                );
            }
            if ( propValue.length > 256 ) {
                return new ValidationError( TOO_LONG,
                    loc( 'S_MAIL_ERROR_MAX_CHARS', 256 )
                );
            }
            return null;
        }
    }),

    parent: Record.toOne({
        // Type: Mailbox,
        key: 'parentId',
        defaultValue: null,
        willSet: function ( propValue, propKey, record ) {
            if ( propValue ) {
                record.set( 'accountId', propValue.get( 'accountId' ) );
            }
            return true;
        },
    }),

    role: attr( String, {
        defaultValue: null
    }),

    sortOrder: attr( Number, {
        defaultValue: 10
    }),

    // ---

    isSubscribed: attr( Boolean, {
        defaultValue: true,
    }),

    myRights: attr( Object, {
        defaultValue: {
            mayReadItems: true,
            mayAddItems: true,
            mayRemoveItems: true,
            maySetSeen: true,
            maySetKeywords: true,
            mayCreateChild: true,
            mayRename: true,
            mayDelete: true,
            maySubmit: true,
            mayAdmin: true,
        },
        noSync: true
    }),

    mayAddItems: function () {
        return this.get( 'myRights' ).mayAddItems &&
            this.get( 'role' ) !== 'snoozed';
    }.property( 'role', 'myRights' ),

    // ---

    totalEmails: attr( Number, {
        defaultValue: 0,
        noSync: true
    }),
    unreadEmails: attr( Number, {
        defaultValue: 0,
        noSync: true
    }),
    totalThreads: attr( Number, {
        defaultValue: 0,
        noSync: true
    }),
    unreadThreads: attr( Number, {
        defaultValue: 0,
        noSync: true
    }),

    // ---

    displayName: function () {
        return this.get( 'name' );
    }.property( 'name' ),

    subfolders: function () {
        var storeKey = this.get( 'storeKey' );
        var store = this.get( 'store' );
        var accountId = this.get( 'accountId' );
        return storeKey ?
            store.getAll( Mailbox,
                function ( data ) {
                    return data.accountId === accountId &&
                        data.parentId === storeKey;
                },
                bySortOrderRoleOrName
            ) :
            new RecordArray( store, Mailbox, [] );
    }.property().nocache(),

    depth: function () {
        var parent = this.get( 'parent' );
        return parent ? parent.get( 'depth' ) + 1 : 0;
    }.property( 'parent' ),

    depthDidChange: function ( _, __, oldDepth ) {
        if ( oldDepth !== this.get( 'depth' ) ) {
            this.get( 'subfolders' ).forEach( function ( mailbox ) {
                mailbox.computedPropertyDidChange( 'depth' );
            });
        }
    }.observes( 'depth' ),

    // ---

    moveTo: function ( dest, where ) {
        var sub = ( where === 'sub' );
        var parent = sub ? dest : dest.get( 'parent' );
        var accountId = dest.get( 'accountId' );
        var siblings = parent ?
                parent.get( 'subfolders' ) :
                this.get( 'store' ).getQuery( 'rootMailboxes-' + accountId,
                LocalQuery, {
                    Type: Mailbox,
                    where: function ( data ) {
                        return !data.parentId && data.accountId === accountId &&
                            data.role !== 'xnotes';
                    },
                    sort: bySortOrderRoleOrName,
                });
        var index = sub ? 0 :
                siblings.indexOf( dest ) + ( where === 'next' ? 1 : 0 );
        var prev = index ? siblings.getObjectAt( index - 1 ) : null;
        var next = siblings.getObjectAt( index );
        var prevSortOrder = prev ? prev.get( 'sortOrder' ) : 0;
        var nextSortOrder = next ? next.get( 'sortOrder' ) : ( index + 2 ) * 32;
        var i, p, l, folder;

        if ( nextSortOrder - prevSortOrder < 2 ) {
            for ( i = 0, p = 32, l = siblings.get( 'length' );
                    i < l; i += 1, p += 32 ) {
                folder = siblings.getObjectAt( i );
                if ( folder !== this ) {
                    folder.set( 'sortOrder', p );
                    if ( folder === prev ) {
                        p += 32;
                    }
                }
            }
            if ( prev ) { prevSortOrder = prev.get( 'sortOrder' ); }
            if ( next ) { nextSortOrder = next.get( 'sortOrder' ); }
        }
        this.set( 'parent', parent || null )
            .set( 'sortOrder', ( nextSortOrder + prevSortOrder ) >> 1 );
    },

    // ---

    destroy: function () {
        // Check ACL
        if ( this.get( 'myRights' ).mayDelete ) {
            // Destroy dependent records
            this.get( 'subfolders' ).forEach( function ( folder ) {
                folder.destroy();
            });
            Mailbox.parent.destroy.call( this );
        }
    },
});
Mailbox.__guid__ = 'Mailbox';
Mailbox.dataGroup = 'urn:ietf:params:jmap:mail';

Mailbox.prototype.parent.Type = Mailbox;

Mailbox.noChildRole = {
    snoozed: true,
    junk: true,
    trash: true,
};

// ---

connection.ignoreCountsForMailboxIds = null;
connection.fetchIgnoredMailboxes = function () {
    var idToMailbox = connection.ignoreCountsForMailboxIds;
    if ( idToMailbox ) {
        Object.values( idToMailbox ).forEach( function ( mailbox ) {
            mailbox.fetch();
        });
    }
    connection.ignoreCountsForMailboxIds = null;
};

// ---

connection.handle( Mailbox, {

    precedence: 0,

    fetch: 'Mailbox',

    refresh: function ( accountId, ids, state ) {
        var get = 'Mailbox/get';
        if ( ids ) {
            this.callMethod( get, {
                accountId: accountId,
                ids: ids,
                properties: [
                    'totalEmails', 'unreadEmails',
                    'totalThreads', 'unreadThreads',
                ],
            });
        } else {
            var changes = 'Mailbox/changes';
            this.callMethod( changes, {
                accountId: accountId,
                sinceState: state,
            });
            var methodId = this.getPreviousMethodId();
            this.callMethod( get, {
                accountId: accountId,
                '#ids': {
                    resultOf: methodId,
                    name: changes,
                    path: '/created',
                },
            });
            this.callMethod( get, {
                accountId: accountId,
                '#ids': {
                    resultOf: methodId,
                    name: changes,
                    path: '/updated',
                },
                '#properties': {
                    resultOf: methodId,
                    name: changes,
                    path: '/updatedProperties',
                },
            });
        }
    },

    commit: function ( change ) {
        var args = makeSetRequest( change, false );
        args.onDestroyRemoveEmails = true;
        this.callMethod( 'Mailbox/set', args );
    },

    // ---

    'Mailbox/get': function ( args, _, reqArgs ) {
        const isAll = ( reqArgs.ids === null );
        const ignoreCounts = this.ignoreCountsForMailboxIds;
        if ( ignoreCounts && args.list ) {
            const accountId = args.accountId;
            args.list.forEach( function ( item ) {
                var mailbox = ignoreCounts[ accountId + '/' + item.id ];
                if ( mailbox ) {
                    item.totalThreads = mailbox.get( 'totalThreads' );
                    item.unreadEmails = mailbox.get( 'unreadEmails' );
                    item.totalEmails = mailbox.get( 'totalEmails' );
                    item.unreadThreads = mailbox.get( 'unreadThreads' );
                }
            });
        }
        this.didFetch( Mailbox, args, isAll );
    },

    'Mailbox/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( Mailbox, args, hasDataForChanged );
        if ( args.hasMoreChanges ) {
            this.fetchMoreChanges( args.accountId, Mailbox );
        }
    },

    'error_Mailbox/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( accountId, Mailbox );
    },

    'Mailbox/set': function ( args ) {
        this.didCommit( Mailbox, args );
    },
});
Mailbox.roleSortOrder = roleSortOrder;
Mailbox.bySortOrderRoleOrName = bySortOrderRoleOrName;

// --- Export

JMAP.Mailbox = Mailbox;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Message.js                                                           \\
// Module: MailModel                                                          \\
// Requires: API, Mailbox.js                                                  \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP, undefined ) {

const isEqual = O.isEqual;
const clone = O.clone;
const i18n = O.i18n;
const Class = O.Class;
const Status = O.Status;
const EMPTY = Status.EMPTY;
const READY = Status.READY;
const LOADING = Status.LOADING;
const NEW = Status.NEW;
const Record = O.Record;
const attr = Record.attr;

const Mailbox = JMAP.Mailbox;
const mail = JMAP.mail;

// ---

const parseStructure = function  ( parts, multipartType, inAlternative,
        htmlParts, textParts, fileParts ) {

    // For multipartType == alternative
    var textLength = textParts ? textParts.length : -1;
    var htmlLength = htmlParts ? htmlParts.length : -1;
    var i;

    for ( i = 0; i < parts.length; i += 1 ) {
        var part = parts[i];
        var type = part.type;
        var isText = false;
        var isMultipart = false;
        var isImage = false;
        var isInline, subMultiType;

        if ( type.startsWith( 'text/' ) ) {
            isText = true;
        } else if ( type.startsWith( 'multipart/' ) ) {
            isMultipart = true;
        } else if ( type.startsWith( 'image/' ) ) {
            isImage = true;
        }

        // Is this a body part rather than an attachment
        isInline =
            // Must be one of the allowed body types
            ( isText || isImage ) && type !== 'text/calendar' &&
            // Must not be explicitly marked as an attachment
            part.disposition !== 'attachment' &&
            // If multipart/related, only the first part can be inline
            // If a text part with a filename, and not the first item in the
            // multipart, assume it is an attachment
            ( i === 0 ||
                ( multipartType !== 'related' && ( isImage || !part.name ) ) );

        if ( isMultipart ) {
            subMultiType = type.split( '/' )[1];
            parseStructure( part.subParts, subMultiType,
                inAlternative || ( subMultiType === 'alternative' ),
                htmlParts, textParts, fileParts );
        } else if ( isInline ) {
            if ( multipartType === 'alternative' ) {
                if ( type === 'text/html' ) {
                    htmlParts.push( part );
                } else if ( isText && textParts.length === textLength ) {
                    textParts.push( part );
                } else if ( type === 'text/plain' ) {
                    // We've found a text/plain but already chose a text part.
                    // Replace it and move the other part to files instead.
                    fileParts.push( textParts.pop() );
                    textParts.push( part );
                } else {
                    fileParts.push( part );
                }
                continue;
            } else if ( inAlternative ) {
                if ( isText ) {
                    if ( type === 'text/html' ) {
                        textParts = null;
                    } else {
                        htmlParts = null;
                    }
                }
            }
            if ( textParts ) {
                textParts.push( part );
            }
            if ( htmlParts ) {
                htmlParts.push( part );
            }
            if ( isImage ) {
                part.isInline = true;
                fileParts.push( part );
            }
        } else {
            fileParts.push( part );
        }
    }

    if ( multipartType === 'alternative' && textParts && htmlParts ) {
        // Found HTML part only
        if ( textLength === textParts.length &&
                htmlLength !== htmlParts.length ) {
            for ( i = htmlLength; i < htmlParts.length; i += 1 ) {
                textParts.push( htmlParts[i] );
            }
        }
        // Found plain text part only
        if ( htmlLength === htmlParts.length &&
                textLength !== textParts.length ) {
            for ( i = textLength; i < textParts.length; i += 1 ) {
                htmlParts.push( textParts[i] );
            }
        }
    }
};

const keywordProperty = function ( keyword ) {
    return function ( value ) {
        if ( value !== undefined ) {
            this.setKeyword( keyword, value );
        } else {
            value = this.get( 'keywords' )[ keyword ];
        }
        return !!value;
    // doNotNotify because observers will be notified already due to the
    // keywords dependency.
    }.property( 'keywords' ).doNotNotify();
};

const MessageDetails = Class({ Extends: Record });
const MessageThread = Class({ Extends: Record });
const MessageBodyValues = Class({ Extends: Record });

const Message = Class({

    Extends: Record,

    thread: Record.toOne({
        // Type: JMAP.Thread,
        key: 'threadId',
        noSync: true,
    }),

    mailboxes: Record.toMany({
        recordType: Mailbox,
        key: 'mailboxIds',
        Type: Object,
        isNullable: false,
    }),

    keywords: attr( Object, {
        defaultValue: {}
    }),

    hasAttachment: attr( Boolean, {
        noSync: true,
    }),

    from: attr( Array ),
    to: attr( Array ),
    subject: attr( String ),

    receivedAt: attr( Date, {
        toJSON: Date.toUTCJSON,
    }),

    size: attr( Number, {
        noSync: true,
    }),

    preview: attr( String, {
        noSync: true,
    }),

    // ---

    getThreadIfReady: function () {
        var store = this.get( 'store' );
        var data = this.getData();
        if ( data && ( store.getStatus( data.threadId ) & READY ) ) {
            return this.get( 'thread' );
        }
        return null;
    },

    hasPermission: function ( permission ) {
        return this.get( 'mailboxes' ).every( function ( mailbox ) {
            return mailbox.get( 'myRights' )[ permission ];
        });
    },

    isIn: function ( role ) {
        return this.get( 'mailboxes' ).some( function ( mailbox ) {
            return mailbox.get( 'role' ) === role;
        });
    },

    isInTrash: function () {
        return this.isIn( 'trash' );
    }.property( 'mailboxes' ),

    isInNotTrash: function () {
        return !this.get( 'isInTrash' ) ||
            ( this.get( 'mailboxes' ).get( 'length' ) > 1 );
    }.property( 'mailboxes' ),

    notifyThread: function () {
        var thread = this.getThreadIfReady();
        if ( thread ) {
            thread.propertyDidChange( 'messages' );
        }
    }.queue( 'before' ).observes( 'mailboxes', 'keywords', 'hasAttachment' ),

    // ---

    isUnread: function ( value ) {
        if ( value !== undefined ) {
            this.setKeyword( '$seen', !value );
        } else {
            var keywords = this.get( 'keywords' );
            value = !keywords.$seen && !keywords.$draft;
        }
        return value;
    }.property( 'keywords' ),

    isDraft: keywordProperty( '$draft' ),
    isFlagged: keywordProperty( '$flagged' ),
    isAnswered: keywordProperty( '$answered' ),
    isForwarded: keywordProperty( '$forwarded' ),
    isPhishing: keywordProperty( '$phishing' ),

    setKeyword: function ( keyword, value ) {
        var keywords = clone( this.get( 'keywords' ) );
        if ( value ) {
            keywords[ keyword ] = true;
        } else {
            delete keywords[ keyword ];
        }
        return this.set( 'keywords', keywords );
    },

    // ---

    fromName: function () {
        var from = this.get( 'from' );
        var emailer = from && from[0] || null;
        return emailer &&
            ( emailer.name ||
            ( emailer.email && emailer.email.split( '@' )[0] ) ) ||
            '';
    }.property( 'from' ),

    fromEmail: function () {
        var from = this.get( 'from' );
        var emailer = from && from[0] || null;
        return emailer && emailer.email || '';
    }.property( 'from' ),

    // ---

    formattedSize: function () {
        return i18n.fileSize( this.get( 'size' ), 1 );
    }.property( 'size' ),

    // ---

    detailsStatus: function ( status ) {
        if ( status !== undefined ) {
            return status;
        }
        if ( this.get( 'blobId' ) || this.is( NEW ) ) {
            return READY;
        }
        return EMPTY;
    }.property( 'blobId' ),

    fetchDetails: function () {
        if ( this.get( 'detailsStatus' ) === EMPTY ) {
            mail.fetchRecord(
                this.get( 'accountId' ), MessageDetails, this.get( 'id' ) );
            this.set( 'detailsStatus', EMPTY|LOADING );
        }
    },

    blobId: attr( String, {
        noSync: true,
    }),

    messageId: attr( Array ),
    inReplyTo: attr( Array ),
    references: attr( Array ),

    listId: attr( String, {
        key: 'header:list-id:asText',
    }),
    _listPost: attr( Array, {
        key: 'header:list-post:asURLs',
    }),
    listPost: function () {
        var urls = this.get( '_listPost' );
        var mailto = urls && urls.find( function ( url ) {
            return url.startsWith( 'mailto:' );
        });
        return mailto ? mailto.slice( 7 ) : '';
    }.property( '_listPost' ),

    sender: attr( Array ),
    replyTo: attr( Array ),
    cc: attr( Array ),
    bcc: attr( Array ),
    sentAt: attr( Date, {
        toJSON: Date.toTimezoneOffsetJSON,
    }),

    bodyStructure: attr( Object ),
    bodyValues: attr( Object ),

    bodyParts: function () {
        var bodyStructure = this.get( 'bodyStructure' );
        var htmlParts = [];
        var textParts = [];
        var fileParts = [];

        if ( bodyStructure ) {
            parseStructure( [ bodyStructure ], 'mixed', false,
                htmlParts, textParts, fileParts );
        }

        return {
            html: htmlParts,
            text: textParts,
            files: fileParts,
        };
    }.property( 'bodyStructure' ),

    hasHTMLBody: function () {
        return this.get( 'bodyParts' ).html.some( function ( part ) {
            return part.type === 'text/html';
        });
    }.property( 'bodyParts' ),

    hasTextBody: function () {
        return this.get( 'bodyParts' ).text.some( function ( part ) {
            const type = part.type;
            return type.startsWith( 'text/' ) && type !== 'text/html';
        });
    }.property( 'bodyParts' ),

    areBodyValuesFetched: function ( type ) {
        var bodyParts = this.get( 'bodyParts' );
        var bodyValues = this.get( 'bodyValues' );
        var partIsFetched = function ( part ) {
            var value = bodyValues[ part.partId ];
            return !part.type.startsWith( 'text' ) ||
                ( !!value && !value.isTruncated );

        };
        var isFetched = true;
        if ( isFetched && type !== 'text' ) {
            isFetched = bodyParts.html.every( partIsFetched );
        }
        if ( isFetched && type !== 'html' ) {
            isFetched = bodyParts.text.every( partIsFetched );
        }
        return isFetched;
    },

    fetchBodyValues: function () {
        mail.fetchRecord(
            this.get( 'accountId' ), MessageBodyValues, this.get( 'id' ) );
    },

    // ---

    hasObservers: function () {
        if ( Message.parent.hasObservers.call( this ) ) {
            return true;
        }
        var data = this.getData();
        var threadSK = data && data.threadId;
        if ( threadSK ) {
            return this.get( 'store' )
                .materialiseRecord( threadSK )
                .hasObservers();
        }
        return false;
    },
});
Message.__guid__ = 'Email';
Message.dataGroup = 'urn:ietf:params:jmap:mail';

Message.headerProperties = [
    'threadId',
    'mailboxIds',
    'keywords',
    'hasAttachment',
    'from',
    'to',
    'subject',
    'receivedAt',
    'size',
    'preview',
];
Message.detailsProperties = [
    'blobId',
    'messageId',
    'inReplyTo',
    'references',
    'header:list-id:asText',
    'header:list-post:asURLs',
    'sender',
    'cc',
    'bcc',
    'replyTo',
    'sentAt',
    'bodyStructure',
    'bodyValues',
];
Message.bodyProperties = [
    'partId',
    'blobId',
    'size',
    'name',
    'type',
    'charset',
    'disposition',
    'cid',
    'location',
];
Message.mutableProperties = [
    'mailboxIds',
    'keywords',
];
Message.Details = MessageDetails;
Message.Thread = MessageThread;
Message.BodyValues = MessageBodyValues;

// ---

mail.handle( MessageDetails, {
    fetch: function ( accountId, ids ) {
        this.callMethod( 'Email/get', {
            accountId: accountId,
            ids: ids,
            properties: Message.detailsProperties,
            fetchHTMLBodyValues: true,
            bodyProperties: Message.bodyProperties,
        });
    },
});

mail.handle( MessageBodyValues, {
    fetch: function ( accountId, ids ) {
        this.callMethod( 'Email/get', {
            accountId: accountId,
            ids: ids,
            properties: [ 'bodyValues' ],
            fetchAllBodyValues: true,
            bodyProperties: Message.bodyProperties,
        });
    },
});

// ---

mail.handle( MessageThread, {
    fetch: function ( accountId, ids ) {
        this.callMethod( 'Email/get', {
            accountId: accountId,
            ids: ids,
            properties: [ 'threadId' ],
        });
        this.callMethod( 'Thread/get', {
            accountId: accountId,
            '#ids': {
                resultOf: this.getPreviousMethodId(),
                name: 'Email/get',
                path: '/list/*/threadId',
            },
        });
        this.callMethod( 'Email/get', {
            accountId: accountId,
            '#ids': {
                resultOf: this.getPreviousMethodId(),
                name: 'Thread/get',
                path: '/list/*/emailIds',
            },
            properties: Message.headerProperties
        });
    },
});

// ---

mail.messageChangesMaxChanges = 50;
mail.handle( Message, {

    precedence: 1,

    fetch: function ( accountId, ids ) {
        // Called with ids == null if you try to refresh before we have any
        // data loaded. Just ignore.
        if ( ids ) {
            this.callMethod( 'Email/get', {
                accountId: accountId,
                ids: ids,
                properties: Message.headerProperties
            });
        }
    },

    refresh: function ( accountId, ids, state ) {
        if ( ids ) {
            this.callMethod( 'Email/get', {
                accountId: accountId,
                ids: ids,
                properties: Message.mutableProperties,
            });
        } else {
            this.callMethod( 'Email/changes', {
                accountId: accountId,
                sinceState: state,
                maxChanges: this.messageChangesMaxChanges,
            });
        }
    },

    commit: 'Email',

    // ---

    'Email/get': function ( args, _, reqArgs ) {
        var store = this.get( 'store' );
        var list = args.list;
        var accountId = args.accountId;
        var l = list ? list.length : 0;
        var message, updates, storeKey;

        // Ensure no null subject, leave message var inited for below
        while ( l-- ) {
            message = list[l];
            if ( message.subject === null ) {
                message.subject = '';
            }
        }

        if ( !message || message.receivedAt ) {
            this.didFetch( Message, args, false );
        } else if ( message.mailboxIds || message.threadId ) {
            // Mutable props: keywords/mailboxIds (OBSOLETE message refreshed)
            // Or threadId/blobId/size from fetch after alreadyExists error
            updates = list.reduce( function ( updates, message ) {
                updates[ message.id ] = message;
                return updates;
            }, {} );
            store.sourceDidFetchPartialRecords( accountId, Message, updates );
        } else if ( !isEqual( reqArgs.properties, [ 'threadId' ] ) ) {
            // This is all immutable data with no foreign key refs, so we don't
            // need to use sourceDidFetchPartialRecords, and this let's us
            // work around a bug where the data is discarded if the message
            // is currently COMMITTING (e.g. moved or keywords changed).
            l = list.length;
            while ( l-- ) {
                message = list[l];
                storeKey = store.getStoreKey( accountId, Message, message.id );
                if ( store.getStatus( storeKey ) & READY ) {
                    store.updateData( storeKey, message, false );
                }
            }
        }
    },

    'Email/changes': function ( args ) {
        this.didFetchUpdates( Message, args, false );
        if ( args.updated && args.updated.length ) {
            this.recalculateAllFetchedWindows();
        }
        if ( args.hasMoreChanges ) {
            var messageChangesMaxChanges = this.messageChangesMaxChanges;
            if ( messageChangesMaxChanges < 150 ) {
                if ( messageChangesMaxChanges === 50 ) {
                    this.messageChangesMaxChanges = 100;
                } else {
                    this.messageChangesMaxChanges = 150;
                }
                this.fetchMoreChanges( args.accountId, Message );
                return;
            } else {
                // We've fetched 300 updates and there's still more. Let's give
                // up and reset.
                this.response[ 'error_Email/changes_cannotCalculateChanges' ]
                    .apply( this, arguments );
            }
        }
        this.messageChangesMaxChanges = 50;
    },

    'Email/copy': function ( args, _, reqArgs ) {
        var notCreated = args.notCreated;
        var alreadyExists = notCreated ?
            Object.keys( notCreated )
                .filter( storeKey =>
                    notCreated[ storeKey ].type === 'alreadyExists' ) :
            null;
        if ( alreadyExists && alreadyExists.length ) {
            var create = reqArgs.create;
            this.callMethod( 'Email/set', {
                accountId: reqArgs.accountId,
                update: Object.zip(
                    alreadyExists.map( storeKey =>
                        notCreated[ storeKey ].existingId ),
                    alreadyExists.map( storeKey => {
                        var patch = {};
                        var mailboxIds = create[ storeKey ].mailboxIds;
                        for ( var id in mailboxIds ) {
                            patch[ 'mailboxIds/' + id ] = true;
                        }
                        return patch;
                    })
                ),
            });
            if ( reqArgs.onSuccessDestroyOriginal ) {
                this.callMethod( 'Email/set', {
                    accountId: reqArgs.fromAccountId,
                    destroy: alreadyExists.map(
                        storeKey => create[ storeKey ].id ),
                });
            }
        }
        this.didCopy( Message, args, reqArgs );
    },

    'error_Email/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var store = this.get( 'store' );
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Mark all messages as obsolete.
        // The garbage collector will eventually clean up any messages that
        // no longer exist
        store.getAll( Message ).forEach( function ( message ) {
            if ( message.get( 'accountId' ) === accountId ) {
                message.setObsolete();
            }
        });
        this.recalculateAllFetchedWindows();
        // Tell the store we're now in the new state.
        store.sourceDidFetchUpdates( accountId,
            Message, null, null, store.getTypeState( accountId, Message ), '' );
    },

    'Email/set': function ( args ) {
        this.didCommit( Message, args );
    },
});

// --- Export

JMAP.Message = Message;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: Thread.js                                                            \\
// Module: MailModel                                                          \\
// Requires: API, Message.js                                                  \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const meta = O.meta;
const Class = O.Class;
const Obj = O.Object;
const Enumerable = O.Enumerable;
const ObservableRange = O.ObservableRange;
const Record = O.Record;
const READY = O.Status.READY;

const Message = JMAP.Message;

// ---

const isInTrash = function ( message ) {
    return message.is( READY ) && message.get( 'isInTrash' );
};
const isInNotTrash = function ( message ) {
    return message.is( READY ) && message.get( 'isInNotTrash' );
};

const aggregateBoolean = function ( _, key ) {
    return this.get( 'messages' ).reduce(
    function ( isProperty, message ) {
        return isProperty || message.get( key );
    }, false );
}.property( 'messages' ).nocache();

const aggregateBooleanInNotTrash = function ( _, key ) {
    key = key.slice( 0, -10 );
    return this.get( 'messagesInNotTrash' ).reduce(
    function ( isProperty, message ) {
        return isProperty || message.get( key );
    }, false );
}.property( 'messages' ).nocache();

const aggregateBooleanInTrash = function ( _, key ) {
    key = key.slice( 0, -7 );
    return this.get( 'messagesInTrash' ).reduce(
    function ( isProperty, message ) {
        return isProperty || message.get( key );
    }, false );
}.property( 'messages' ).nocache();

const total = function( property ) {
    return function () {
        return this.get( property ).get( 'length' );
    }.property( 'messages' ).nocache();
};

// senders is [{name: String, email: String}]
const toFrom = function ( message ) {
    var from = message.get( 'from' );
    return from && from[0] || null;
};
const senders = function( property ) {
    return function () {
        return this.get( property )
                   .map( toFrom )
                   .filter( O.Transform.toBoolean );
    }.property( 'messages' ).nocache();
};

const sumSize = function ( size, message ) {
    return size + ( message.get( 'size' ) || 0 );
};
const size = function( property ) {
    return function () {
        return this.get( property ).reduce( sumSize, 0 );
    }.property( 'messages' ).nocache();
};

// ---

const MessageArray = Class({

    Extends: Obj,

    Mixin: [ ObservableRange, Enumerable ],

    init: function ( store, storeKeys ) {
        this._store = store;
        this._storeKeys = storeKeys;

        MessageArray.parent.constructor.call( this );
    },

    length: function () {
        return this._storeKeys.length;
    }.property().nocache(),

    getObjectAt ( index ) {
        var storeKey = this._storeKeys[ index ];
        if ( storeKey ) {
            return this._store.materialiseRecord( storeKey );
        }
    },

    update: function ( storeKeys ) {
        var oldStoreKeys = this._storeKeys;
        var oldLength = oldStoreKeys.length;
        var newLength = storeKeys.length;
        var start = 0;
        var end = newLength;

        this._storeKeys = storeKeys;

        while ( ( start < newLength ) &&
                ( storeKeys[ start ] === oldStoreKeys[ start ] ) ) {
            start += 1;
        }
        if ( newLength === oldLength ) {
            var last = end - 1;
            while ( ( end > start ) &&
                    ( storeKeys[ last ] === oldStoreKeys[ last ] ) ) {
                end = last;
                last -= 1;
            }
        } else {
            end = Math.max( oldLength, newLength );
            this.propertyDidChange( 'length', oldLength, newLength );
        }

        if ( start !== end ) {
            this.rangeDidChange( start, end );
        }
        return this;
    },
});

const toStoreKey = function ( record ) {
    return record.get( 'storeKey' );
};

// ---

const Thread = Class({

    Extends: Record,

    messages: Record.toMany({
        recordType: Message,
        key: 'emailIds',
        isNullable: false,
        noSync: true,
    }),

    messagesInNotTrash: function () {
        return new MessageArray(
            this.get( 'store' ),
            this.get( 'messages' ).filter( isInNotTrash ).map( toStoreKey )
        );
    }.property(),

    messagesInTrash: function () {
        return new MessageArray(
            this.get( 'store' ),
            this.get( 'messages' ).filter( isInTrash ).map( toStoreKey )
         );
    }.property(),

    _setSubsetMessagesContent: function () {
        var cache = meta( this ).cache;
        var messagesInNotTrash = cache.messagesInNotTrash;
        var messagesInTrash = cache.messagesInTrash;
        if ( messagesInNotTrash ) {
            messagesInNotTrash.update(
                this.get( 'messages' ).filter( isInNotTrash ).map( toStoreKey )
            );
        }
        if ( messagesInTrash ) {
            messagesInTrash.update(
                this.get( 'messages' ).filter( isInTrash ).map( toStoreKey )
            );
        }
    }.observes( 'messages' ),

    isAll: function ( status ) {
        return this.is( status ) &&
            // .reduce instead of .every so we deliberately fetch every record
            // object from the store, triggering a fetch if not loaded
            this.get( 'messages' ).reduce( function ( isStatus, message ) {
                return isStatus && message.is( status );
            }, true );
    },

    mailboxCounts: function () {
        var counts = {};
        this.get( 'messages' ).forEach( function ( message ) {
            message.get( 'mailboxes' ).forEach( function ( mailbox ) {
                var storeKey = mailbox.get( 'storeKey' );
                counts[ storeKey ] = ( counts[ storeKey ] ||  0 ) + 1;
            });
        });
        return counts;
    }.property( 'messages' ),

    // ---

    isUnread: aggregateBoolean,
    isFlagged: aggregateBoolean,
    isDraft: aggregateBoolean,
    hasAttachment: aggregateBoolean,

    total: total( 'messages' ),
    senders: senders( 'messages' ),
    size: size( 'messages' ),

    // ---

    isUnreadInNotTrash: aggregateBooleanInNotTrash,
    isFlaggedInNotTrash: aggregateBooleanInNotTrash,
    isDraftInNotTrash: aggregateBooleanInNotTrash,
    hasAttachmentInNotTrash: aggregateBooleanInNotTrash,

    totalInNotTrash: total( 'messagesInNotTrash' ),
    sendersInNotTrash: senders( 'messagesInNotTrash' ),
    sizeInNotTrash: size( 'messagesInNotTrash' ),

    // ---

    isUnreadInTrash: aggregateBooleanInTrash,
    isFlaggedInTrash: aggregateBooleanInTrash,
    isDraftInTrash: aggregateBooleanInTrash,
    hasAttachmentInTrash: aggregateBooleanInTrash,

    totalInTrash: total( 'messagesInTrash' ),
    sendersInTrash: senders( 'messagesInTrash' ),
    sizeInTrash: size( 'messagesInTrash' )
});
Thread.__guid__ = 'Thread';
Thread.dataGroup = 'urn:ietf:params:jmap:mail';

JMAP.mail.threadChangesMaxChanges = 50;
JMAP.mail.handle( Thread, {

    fetch: function ( accountId, ids ) {
        // Called with ids == null if you try to refresh before we have any
        // data loaded. Just ignore.
        if ( ids ) {
            this.callMethod( 'Thread/get', {
                accountId: accountId,
                ids: ids,
            });
            this.callMethod( 'Email/get', {
                accountId: accountId,
                '#ids': {
                    resultOf: this.getPreviousMethodId(),
                    name: 'Thread/get',
                    path: '/list/*/emailIds',
                },
                properties: Message.headerProperties,
            });
        }
    },

    refresh: function ( accountId, ids, state ) {
        if ( ids ) {
            this.callMethod( 'Thread/get', {
                accountId: accountId,
                ids: ids,
            });
        } else {
            this.callMethod( 'Thread/changes', {
                accountId: accountId,
                sinceState: state,
                maxChanges: this.threadChangesMaxChanges,
            });
        }
    },

    //  ---

    'Thread/get': function ( args ) {
        this.didFetch( Thread, args, false );
    },

    'Thread/changes': function ( args ) {
        this.didFetchUpdates( Thread, args, false );
        if ( args.updated && args.updated.length ) {
            this.recalculateAllFetchedWindows();
        }
        if ( args.hasMoreChanges ) {
            const threadChangesMaxChanges = this.threadChangesMaxChanges;
            if ( threadChangesMaxChanges < 150 ) {
                if ( threadChangesMaxChanges === 50 ) {
                    this.threadChangesMaxChanges = 100;
                } else {
                    this.threadChangesMaxChanges = 150;
                }
                this.fetchMoreChanges( args.accountId, Thread );
                return;
            } else {
                // We've fetched 300 updates and there's still more. Let's give
                // up and reset.
                this.response[ 'error_Thread/changes_cannotCalculateChanges' ]
                    .apply( this, arguments );
            }
        }
        this.threadChangesMaxChanges = 50;
    },

    'error_Thread/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var store = this.get( 'store' );
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Unload if possible, otherwise mark
        // obsolete.
        store.getAll( Thread ).forEach( function ( thread ) {
            if ( thread.get( 'accountId' ) === accountId ) {
                if ( !store.unloadRecord( thread.get( 'storeKey' ) ) ) {
                    thread.setObsolete();
                }
            }
        });
        this.recalculateAllFetchedWindows();
        // Tell the store we're now in the new state.
        store.sourceDidFetchUpdates(
            accountId, Thread, null, null,
            store.getTypeState( accountId, Thread ), ''
        );
    },
});

// ---

// Circular dependency
Message.prototype.thread.Type = Thread;

// --- Export

JMAP.Thread = Thread;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: MessageList.js                                                       \\
// Module: MailModel                                                          \\
// Requires: API, Message.js, Thread.js                                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP, undefined ) {

const Class = O.Class;
const WindowedQuery = O.WindowedQuery;
const isEqual = O.isEqual;
const Status = O.Status;
const EMPTY = Status.EMPTY;
const READY = Status.READY;
const NEW = Status.NEW;
const OBSOLETE = Status.OBSOLETE;
const LOADING = Status.LOADING;

const getQueryId = JMAP.getQueryId;
const Message = JMAP.Message;

// ---

const statusIsFetched = function ( store, storeKey ) {
    var status = store.getStatus( storeKey );
    return ( status & READY ) &&
        ( !( status & OBSOLETE ) || ( status & LOADING ) );
};
const refreshIfNeeded = function ( record ) {
    const status = record.get( 'status' );
    if ( ( status & OBSOLETE ) && !( status & LOADING ) ) {
        record.fetch();
    }
};

const EMPTY_SNIPPET = {
    body: ' ',
};

const getId = function ( args ) {
    return getQueryId( Message, args ) + ( args.collapseThreads ? '+' : '-' );
};

const MessageList = Class({

    Extends: WindowedQuery,

    optimiseFetching: true,

    sort: [{ property: 'receivedAt', isAscending: false }],
    collapseThreads: true,
    findAllInThread: false,

    Type: Message,

    init: function ( options ) {
        this._snippets = {};
        this._snippetsNeeded = [];

        this.threadIdToEmailIds = {};

        MessageList.parent.constructor.call( this, options );
    },

    // Precondition: All ids are fetched for the window to be checked.
    checkIfWindowIsFetched: function ( index ) {
        var store = this.get( 'store' );
        var windowSize = this.get( 'windowSize' );
        var storeKeys = this.getStoreKeys();
        var i = index * windowSize;
        var l = Math.min( i + windowSize, this.get( 'length' ) );
        var collapseThreads = this.get( 'collapseThreads' );
        var messageSK, threadSK, thread;
        for ( ; i < l; i += 1 ) {
            messageSK = storeKeys[i];
            // No message, or out-of-date
            if ( !messageSK || !statusIsFetched( store, messageSK ) ) {
                return false;
            }
            if ( collapseThreads ) {
                threadSK = store.getRecordFromStoreKey( messageSK )
                                .getData()
                                .threadId;
                // No thread, or out-of-date
                if ( !statusIsFetched( store, threadSK ) ) {
                    return false;
                }
                thread = store.getRecordFromStoreKey( threadSK );
                if ( !thread.getData().emailIds.every(
                        statusIsFetched.bind( null, store ) ) ) {
                    return false;
                }
            }
        }
        return true;
    },

    sourceWillFetchQuery: function () {
        var req = MessageList.parent.sourceWillFetchQuery.call( this );

        // If we have all the ids already, optimise the loading of the records.
        var store = this.get( 'store' );
        var storeKeys = this.getStoreKeys();
        var length = this.get( 'length' );
        var collapseThreads = this.get( 'collapseThreads' );

        req.records = req.records.filter( function ( req ) {
            var i = req.start;
            var l = i + req.count;
            var message, thread, messageSK, status;

            if ( length ) {
                l = Math.min( l, length );
            }

            while ( i < l ) {
                messageSK = storeKeys[i];
                if ( messageSK ) {
                    i += 1;
                } else {
                    messageSK = storeKeys[ l - 1 ];
                    if ( !messageSK ) { break; }
                    l -= 1;
                }
                // Fetch the Message objects (if not already fetched).
                // If already fetched, fetch the updates
                if ( collapseThreads ) {
                    status = store.getStatus( messageSK );
                    // If it's a draft pre-emptively added to the message
                    // list, ignore it
                    if ( status & NEW ) {
                        continue;
                    }
                    if ( status & READY ) {
                        thread = store.getRecordFromStoreKey( messageSK )
                                      .get( 'thread' );
                        // If already fetched, fetch the updates
                        refreshIfNeeded( thread );
                        thread.get( 'messages' ).forEach( refreshIfNeeded );
                    } else {
                        JMAP.mail.fetchRecord(
                            store.getAccountIdFromStoreKey( messageSK ),
                            Message.Thread,
                            store.getIdFromStoreKey( messageSK )
                        );
                    }
                } else {
                    message = store.getRecordFromStoreKey( messageSK );
                    refreshIfNeeded( message );
                }
            }
            req.start = i;
            req.count = l - i;
            return i !== l;
        });

        return req;
    },

    // --- Snippets ---

    sourceDidFetchSnippets: function ( accountId, snippets ) {
        var store = this.get( 'store' );
        var l = snippets.length;
        var snippet, emailId;
        while ( l-- ) {
            snippet = snippets[l];
            emailId = snippet.emailId;
            this._snippets[ emailId ] = snippet;
            if ( store.getRecordStatus(
                    accountId, Message, emailId ) & READY ) {
                // There is no "snippet" property, but this triggers the
                // observers of * property changes on the object.
                store.getRecord( accountId, Message, emailId )
                     .propertyDidChange( 'snippet' );
            }
        }
    },

    getSnippet: function ( emailId ) {
        var snippet = this._snippets[ emailId ];
        if ( !snippet ) {
            this._snippetsNeeded.push( emailId );
            this._snippets[ emailId ] = snippet = EMPTY_SNIPPET;
            this.fetchSnippets();
        }
        return snippet;
    },

    fetchSnippets: function () {
        JMAP.mail.callMethod( 'SearchSnippet/get', {
            accountId: this.get( 'accountId' ),
            emailIds: this._snippetsNeeded,
            filter: this.get( 'where' ),
        });
        this._snippetsNeeded = [];
    }.queue( 'after' )
});
MessageList.getId = getId;

JMAP.mail.handle( MessageList, {
    query: function ( query ) {
        var accountId = query.get( 'accountId' );
        var where = query.get( 'where' );
        var sort = query.get( 'sort' );
        var collapseThreads = query.get( 'collapseThreads' );
        var findAllInThread = query.get( 'findAllInThread' );
        var canGetDeltaUpdates = query.get( 'canGetDeltaUpdates' );
        var queryState = query.get( 'queryState' );
        var request = query.sourceWillFetchQuery();
        var refresh = request.refresh;
        var hasMadeRequest = false;
        var isEmpty = ( query.get( 'status' ) & EMPTY );

        var fetchThreads = function () {
            this.callMethod( 'Thread/get', {
                accountId: accountId,
                '#ids': {
                    resultOf: this.getPreviousMethodId(),
                    name: 'Email/get',
                    path: '/list/*/threadId',
                },
            });
            this.callMethod( 'Email/get', {
                accountId: accountId,
                '#ids': {
                    resultOf: this.getPreviousMethodId(),
                    name: 'Thread/get',
                    path: '/list/*/emailIds',
                },
                properties: Message.headerProperties,
            });
        }.bind( this );

        if ( canGetDeltaUpdates && queryState && refresh ) {
            var storeKeys = query.getStoreKeys();
            var length = storeKeys.length;
            var upToId = ( length === query.get( 'length' ) ) ?
                    undefined : storeKeys[ length - 1 ];
            this.callMethod( 'Email/queryChanges', {
                accountId: accountId,
                filter: where,
                sort: sort,
                collapseThreads: collapseThreads,
                findAllInThread: findAllInThread,
                sinceQueryState: queryState,
                upToId: upToId ?
                    this.get( 'store' ).getIdFromStoreKey( upToId ) : null,
                maxChanges: 25,
                calculateTotal: true,
            });
            this.callMethod( 'Email/get', {
                accountId: accountId,
                '#ids': {
                    resultOf: this.getPreviousMethodId(),
                    name: 'Email/queryChanges',
                    path: '/added/*/id',
                },
                properties: collapseThreads ?
                    [ 'threadId' ] : Message.headerProperties,
            });
            if ( collapseThreads ) {
                fetchThreads();
            }
        }

        if ( request.callback ) {
            this.addCallback( request.callback );
        }

        var calculateTotal = !!( where && where.inMailbox ) ||
            ( !isEmpty && !query.get( 'hasTotal' ) ) ||
            ( !canGetDeltaUpdates && !!refresh );
        var get = function ( start, count, anchor, offset, fetchData ) {
            this.callMethod( 'Email/query', {
                accountId: accountId,
                filter: where,
                sort: sort,
                collapseThreads: collapseThreads,
                findAllInThread: findAllInThread,
                position: start,
                anchor: anchor,
                anchorOffset: offset,
                limit: count,
                calculateTotal: calculateTotal,
            });
            hasMadeRequest = true;
            calculateTotal = false;
            if ( fetchData ) {
                this.callMethod( 'Email/get', {
                    accountId: accountId,
                    '#ids': {
                        resultOf: this.getPreviousMethodId(),
                        name: 'Email/query',
                        path: '/ids',
                    },
                    properties: collapseThreads ?
                        [ 'threadId' ] : Message.headerProperties,
                });
                if ( collapseThreads ) {
                    fetchThreads();
                }
            }
        }.bind( this );

        request.ids.forEach( function ( req ) {
            get( req.start, req.count, undefined, undefined, false );
        });
        request.records.forEach( function ( req ) {
            get( req.start, req.count, undefined, undefined, true );
        });
        request.indexOf.forEach( function ( req ) {
            get( undefined, 1, req[0], 0, false );
            this.addCallback( req[1] );
        }, this );

        if ( ( isEmpty && !request.records.length ) ||
             ( !canGetDeltaUpdates && !hasMadeRequest && refresh ) ) {
            get( 0, query.get( 'windowSize' ), undefined, undefined, true );
        }
    },

    // ---

    'Email/query': function ( args, _, reqArgs ) {
        const query = this.get( 'store' ).getQuery( getId( reqArgs ) );
        var total, hasTotal, numIds, threadIdToEmailIds;
        if ( query ) {
            if ( args.total === undefined ) {
                total = query.get( 'length' );
                hasTotal = query.get( 'hasTotal' ) && total !== null;
                if ( !hasTotal ) {
                    numIds = args.ids.length;
                    total = args.position + numIds;
                    if ( numIds < reqArgs.limit ) {
                        hasTotal = true;
                    } else {
                        total += 1;
                    }
                }
                args.total = total;
            } else {
                hasTotal = true;
            }
            threadIdToEmailIds = args.threadIdToEmailIds;
            if ( threadIdToEmailIds ) {
                Object.assign( query.threadIdToEmailIds, threadIdToEmailIds );
            }
            query.set( 'error', null );
            query.set( 'hasTotal', hasTotal );
            query.set( 'canGetDeltaUpdates', args.canCalculateChanges );
            query.sourceDidFetchIds( args );
        }
    },

    // We don't care if the anchor isn't found - this was just looking for an
    // index, and this means it's not in the query.
    'error_Email/query_anchorNotFound': function () {},

    // Any other error,
    // e.g. unsupportedFilter, unsupportedSort, invalidArguments etc.
    'error_Email/query': function ( args, requestName, requestArgs ) {
        var query = this.get( 'store' ).getQuery( getId( requestArgs ) );
        if ( query ) {
            query.set( 'error', args.type );
            query.sourceDidFetchIds({
                ids: [],
                position: 0,
                total: 0,
            });
        }
    },

    'Email/queryChanges': function ( args, _, reqArgs ) {
        const query = this.get( 'store' ).getQuery( getId( reqArgs ) );
        if ( query ) {
            const threadIdToEmailIds = args.threadIdToEmailIds;
            if ( threadIdToEmailIds ) {
                Object.assign( query.threadIdToEmailIds, threadIdToEmailIds );
            }
            args.upToId = reqArgs.upToId;
            query.sourceDidFetchUpdate( args );
        }
    },

    'error_Email/queryChanges_tooManyChanges': function ( args, requestName, requestArgs ) {
        if ( requestArgs.maxChanges === 25 ) {
            // Try again without fetching the emails
            this.callMethod( 'Email/queryChanges',
                Object.assign( {}, requestArgs, {
                    maxChanges: 250,
                })
            );
        } else {
            this.response[ 'error_Email/queryChanges' ]
                .call( this, args, requestName, requestArgs );
        }
    },

    // Any other error, e.g. cannotCalculateChanges, invalidArguments etc.
    'error_Email/queryChanges': function ( _, __, reqArgs ) {
        var query = this.get( 'store' ).getQuery( getId( reqArgs ) );
        if ( query ) {
            query.reset();
        }
    },

    // ---

    'SearchSnippet/get': function ( args, _, reqArgs ) {
        var store = this.get( 'store' );
        var where = reqArgs.filter;
        var list = args.list;
        var accountId = args.accountId;
        store.getAllQueries().forEach( function ( query ) {
            if ( isEqual( query.get( 'where' ), where ) ) {
                query.sourceDidFetchSnippets( accountId, list );
            }
        });
    },
});

JMAP.mail.recalculateAllFetchedWindows = function () {
    // Mark all message lists as needing to recheck if window is fetched.
    this.get( 'store' ).getAllQueries().forEach( function ( query ) {
        if ( query instanceof MessageList ) {
            query.recalculateFetchedWindows();
        }
    });
};

// --- Export

JMAP.MessageList = MessageList;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: MessageSubmission.js                                                 \\
// Module: MailModel                                                          \\
// Requires: API, Mailbox.js, Message.js, Thread.js, Identity.js              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const clone = O.clone;
const guid = O.guid;
const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;
const READY = O.Status.READY;

const mail = JMAP.mail;
const Identity = JMAP.Identity;
const Message = JMAP.Message;
const Thread = JMAP.Thread;
const Mailbox = JMAP.Mailbox;
const applyPatch = JMAP.Connection.applyPatch;
const makeSetRequest = JMAP.Connection.makeSetRequest;

// ---

const MessageSubmission = Class({

    Extends: Record,

    identity: Record.toOne({
        Type: Identity,
        key: 'identityId',
    }),

    message: Record.toOne({
        Type: Message,
        key: 'emailId',
    }),

    thread: Record.toOne({
        Type: Thread,
        key: 'threadId',
        noSync: true,
    }),

    envelope: attr( Object, {
        defaultValue: null,
    }),

    sendAt: attr( Date, {
        toJSON: Date.toUTCJSON,
        noSync: true,
    }),

    undoStatus: attr( String ),

    deliveryStatus: attr( Object, {
        noSync: true,
        defaultValue: null,
    }),

    dsnBlobIds: attr( Array ),
    mdnBlobIds: attr( Array ),

    // ---

    // Not a real JMAP property; stripped before sending to server.
    onSuccess: attr( Object ),
});
MessageSubmission.__guid__ = 'EmailSubmission';
MessageSubmission.dataGroup = 'urn:ietf:params:jmap:submission';

MessageSubmission.makeEnvelope = function ( message, extraRecipients ) {
    var sender = message.get( 'sender' );
    var mailFrom = {
        email: sender && sender[0] ?
            sender[0].email :
            message.get( 'fromEmail' ),
        parameters: null,
    };
    var rcptTo = [];
    var seen = {};
    var addAddress = function ( address ) {
        var email = address.email;
        if ( email && !seen[ email ] ) {
            seen[ email ] = true;
            rcptTo.push({ email: email, parameters: null });
        }
    };
    [ 'to', 'cc', 'bcc' ].forEach( function ( header ) {
        var addresses = message.get( header );
        if ( addresses ) {
            addresses.forEach( addAddress );
        }
    });
    if ( extraRecipients ) {
        extraRecipients.forEach( addAddress );
    }
    return {
        mailFrom: mailFrom,
        rcptTo: rcptTo,
    };
};


mail.handle( MessageSubmission, {

    precedence: 3,

    fetch: function ( accountId, ids ) {
        this.callMethod( 'EmailSubmission/get', {
            accountId: accountId,
            ids: ids || [],
        });
    },

    refresh: 'EmailSubmission',

    commit: function ( change ) {
        var store = this.get( 'store' );
        var args = makeSetRequest( change, false );

        // TODO: Prevent double sending if dodgy connection
        // if ( Object.keys( args.create ).length ) {
        //     args.ifInState = change.state;
        // }

        var onSuccessUpdateEmail = {};
        var onSuccessDestroyEmail = [];
        var create = args.create;
        var update = args.update;
        var accountId = change.accountId;
        var id, submission;

        // On create move from drafts, remove $draft keyword
        for ( id in create ) {
            submission = create[ id ];
            if ( submission.onSuccess === null ) {
                args.onSuccessDestroyEmail = onSuccessDestroyEmail;
                onSuccessDestroyEmail.push( '#' + id );
            } else if ( submission.onSuccess ) {
                args.onSuccessUpdateEmail = onSuccessUpdateEmail;
                onSuccessUpdateEmail[ '#' + id ] = submission.onSuccess;
            }
            delete submission.onSuccess;
        }

        // On unsend, move back to drafts, set $draft keyword.
        for ( id in update ) {
            submission = update[ id ];
            if ( submission.onSuccess === null ) {
                args.onSuccessDestroyEmail = onSuccessDestroyEmail;
                onSuccessDestroyEmail.push( id );
            } else if ( submission.onSuccess ) {
                args.onSuccessUpdateEmail = onSuccessUpdateEmail;
                onSuccessUpdateEmail[ id ] = submission.onSuccess;
            }
            delete submission.onSuccess;
        }

        this.callMethod( 'EmailSubmission/set', args );
        if ( args.onSuccessUpdateEmail || args.onSuccessDestroyEmail ) {
            this.fetchAllRecords(
                accountId, Message, store.getTypeState( accountId, Message ) );
            this.fetchAllRecords(
                accountId, Mailbox, store.getTypeState( accountId, Mailbox ) );
        }
    },

    // ---

    'EmailSubmission/get': function ( args ) {
        this.didFetch( MessageSubmission, args, false );
    },

    'EmailSubmission/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( MessageSubmission, args, hasDataForChanged );
        if ( args.hasMoreChanges ) {
            this.fetchMoreChanges( args.accountId, MessageSubmission );
        }
    },

    'error_EmailSubmission/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var store = this.get( 'store' );
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Unload if possible, otherwise mark
        // obsolete.
        store.getAll( MessageSubmission ).forEach( function ( submission ) {
            if ( submission.get( 'accountId' ) === accountId ) {
                if ( !store.unloadRecord( submission.get( 'storeKey' ) ) ) {
                    submission.setObsolete();
                }
            }
        });
        // Tell the store we're now in the new state.
        store.sourceDidFetchUpdates(
            accountId,
            MessageSubmission,
            null,
            null,
            store.getTypeState( accountId, MessageSubmission ),
            ''
        );

    },

    'EmailSubmission/set': function ( args ) {
        this.didCommit( MessageSubmission, args );
    },

    'error_EmailSubmission/set_stateMismatch': function () {
        // TODO
        // store.sourceDidNotCreate( storeKeys, false,
        //     storeKeys.map( function () { return { type: 'stateMismatch' }
        // }) );
        // 1. Fetch EmailSubmission/changes (inc. fetch records)
        // 2. Check if any of these are sending the same message
        // 3. If not retry. If yes, destroy?
    },

    // ---

    'Email/set': function ( args, reqName, reqArgs ) {
        // If we did a set implicitly on successful send, the change is not in
        // the store, so don't call didCommit. Instead we tell the store the
        // updates the server has made.
        var store = this.get( 'store' );
        var accountId = reqArgs.accountId;
        if ( reqName === 'EmailSubmission/set' ) {
            var create = reqArgs.create;
            var update = reqArgs.update;
            var changes = Object.keys( create || {} ).reduce(
                ( changes, creationId ) => {
                    changes[ '#' + creationId ] = create[ creationId ];
                    return changes;
                },
                update ? clone( update ) : {}
            );
            var onSuccessUpdateEmail = reqArgs.onSuccessUpdateEmail;
            var updated = args.updated;
            var updates = {};
            var emailId, storeKey, path, id, patch, data;
            for ( id in changes ) {
                emailId = changes[ id ].emailId;
                if ( emailId && emailId.charAt( 0 ) === '#' ) {
                    storeKey = emailId.slice( 1 );
                    emailId = store.getIdFromStoreKey( storeKey );
                } else {
                    if ( !emailId ) {
                        emailId = store
                            .getRecord( accountId, MessageSubmission, id )
                            .getFromPath( 'message.id' );
                    }
                    storeKey = store.getStoreKey( accountId, Message, emailId );
                }
                if (
                    updated &&
                    updated[ emailId ] &&
                    onSuccessUpdateEmail &&
                    ( patch = onSuccessUpdateEmail[ id ] )
                ) {
                    // If we've made further changes since this commit, bail
                    // out. This is just an optimisation, and we'll fetch the
                    // real changes from the source instead automatically if
                    // we don't do it.
                    if ( store.getStatus( storeKey ) !== READY ) {
                        continue;
                    }
                    data = store.getData( storeKey );
                    data = {
                        keywords: clone( data.keywords ),
                        mailboxIds: Object.keys( data.mailboxIds ).reduce(
                            function ( mailboxIds, storeKey ) {
                                mailboxIds[
                                    store.getIdFromStoreKey( storeKey )
                                ] = true;
                                return mailboxIds;
                            },
                            {}
                        ),
                    };
                    for ( path in patch ) {
                        applyPatch( data, path, patch[ path ] );
                    }
                    delete updated[ emailId ];
                    updates[ emailId ] = data;
                }
            }
            store.sourceDidFetchUpdates(
                accountId,
                Message,
                updated && Object.keys( updated ),
                args.destroyed,
                args.oldState,
                args.newState
            );
            store.sourceDidFetchPartialRecords( accountId, Message, updates );
            // And we invalidate all MessageList queries, as some may be
            // invalid and we don't know which ones.
            this.get( 'store' )
                .fire( guid( Message ) + ':server:' + accountId );
            return;
        } else {
            var notCreated = args.notCreated;
            if ( notCreated ) {
                // If we get an alreadyExists error, just pretend it was
                // success as long as we don't already have the record loaded.
                // The only thing that could *potentially* differ is the
                // keywords/mailboxes. However, in practice, almost certainly
                // what's happened is that we had a network loss and have
                // retried the create, and the original request actually
                // succeeded; we just never got the response.
                var created = args.created || ( args.created = {} );
                var existing = [];
                Object.keys( notCreated ).forEach( storeKey => {
                    var error = notCreated[ storeKey ];
                    var existingId = error.existingId;
                    if ( error.type === 'alreadyExists' &&!(
                            store.getRecordStatus(
                                accountId, Message, existingId ) & READY
                            )) {
                        delete notCreated[ storeKey ];
                        created[ storeKey ] = {
                            id: existingId,
                        };
                        existing.push( existingId );
                    }
                });
                // We need to fetch the other server-set properties.
                if ( existing.length ) {
                    this.callMethod( 'Email/get', {
                        accountId: accountId,
                        ids: existing,
                        properties: [ 'blobId', 'threadId', 'size' ],
                    });
                }
            }
        }
        this.didCommit( Message, args );
    },
});

// --- Export

JMAP.MessageSubmission = MessageSubmission;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: VacationResponse.js                                                  \\
// Module: MailModel                                                          \\
// Requires: API                                                              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;

const mail = JMAP.mail;

// ---

const VacationResponse = Class({

    Extends: Record,

    isEnabled: attr( Boolean, {
        defaultValue: false,
    }),

    fromDate: attr( Date, {
        toJSON: Date.toUTCJSON,
        defaultValue: null,
    }),

    toDate: attr( Date, {
        toJSON: Date.toUTCJSON,
        defaultValue: null,
    }),

    subject: attr( String ),

    textBody: attr( String ),

    htmlBody: attr( String ),

    // ---

    hasDates: function ( hasDates ) {
        if ( hasDates === false ) {
            this.set( 'fromDate', null )
                .set( 'toDate', null );
        } else if ( hasDates === undefined ) {
            hasDates = !!(
                this.get( 'fromDate' ) ||
                this.get( 'toDate' )
            );
        }
        return hasDates;
    }.property( 'fromDate', 'toDate' ),
});
VacationResponse.__guid__ = 'VacationResponse';
VacationResponse.dataGroup = 'urn:ietf:params:jmap:vacationresponse';

mail.handle( VacationResponse, {

    precedence: 3,

    fetch: 'VacationResponse',
    commit: 'VacationResponse',

    // ---

    'VacationResponse/get': function ( args ) {
        this.didFetch( VacationResponse, args );
    },

    'VacationResponse/set': function ( args ) {
        this.didCommit( VacationResponse, args );
    },
});

// --- Export

JMAP.VacationResponse = VacationResponse;

}( JMAP ) );


// -------------------------------------------------------------------------- \\
// File: mail-model.js                                                        \\
// Module: MailModel                                                          \\
// Requires: API, Mailbox.js, Thread.js, Message.js, MessageList.js, MessageSubmission.js \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const clone = O.clone;
const isEqual = O.isEqual;
const READY = O.Status.READY;

const auth = JMAP.auth;
const store = JMAP.store;
const connection = JMAP.mail;
const Mailbox = JMAP.Mailbox;
const Thread = JMAP.Thread;
const Message = JMAP.Message;
const MessageList = JMAP.MessageList;
const MessageSubmission = JMAP.MessageSubmission;
const SnoozeDetails = JMAP.SnoozeDetails;

// --- Preemptive mailbox count updates ---

const getMailboxDelta = function ( deltas, mailboxSK ) {
    return deltas[ mailboxSK ] || ( deltas[ mailboxSK ] = {
        totalEmails: 0,
        unreadEmails: 0,
        totalThreads: 0,
        unreadThreads: 0,
        removed: [],
        added: []
    });
};

const updateMailboxCounts = function ( mailboxDeltas ) {
    var ignoreCountsForMailboxIds = connection.ignoreCountsForMailboxIds;
    var mailboxSK, delta, mailbox;
    for ( mailboxSK in mailboxDeltas ) {
        delta = mailboxDeltas[ mailboxSK ];
        mailbox = store.getRecordFromStoreKey( mailboxSK );
        if ( delta.totalEmails ) {
            mailbox.set( 'totalEmails', Math.max( 0,
                mailbox.get( 'totalEmails' ) + delta.totalEmails ) );
        }
        if ( delta.unreadEmails ) {
            mailbox.set( 'unreadEmails', Math.max( 0,
                mailbox.get( 'unreadEmails' ) + delta.unreadEmails ) );
        }
        if ( delta.totalThreads ) {
            mailbox.set( 'totalThreads', Math.max( 0,
                mailbox.get( 'totalThreads' ) + delta.totalThreads ) );
        }
        if ( delta.unreadThreads ) {
            mailbox.set( 'unreadThreads', Math.max( 0,
                mailbox.get( 'unreadThreads' ) + delta.unreadThreads ) );
        }
        if ( !connection.get( 'inFlightRequest' ) ) {
            // Fetch the real counts, just in case.
            mailbox.fetch();
        } else {
            // The mailbox may currently be loading; if it loads, it will have
            // data from before this pre-emptive change was made. We need to
            // ignore that and load it again.
            if ( !ignoreCountsForMailboxIds ) {
                connection.ignoreCountsForMailboxIds =
                    ignoreCountsForMailboxIds = {};
                connection.get( 'inFlightCallbacks' )
                    .push([ '', connection.fetchIgnoredMailboxes ]);
            }
            ignoreCountsForMailboxIds[
                mailbox.get( 'accountId' ) + '/' + mailbox.get( 'id' )
            ] = mailbox;
        }
    }
};

// --- Preemptive query updates ---

const isSortedOnKeyword = function ( keyword, sort ) {
    for ( var i = 0, l = sort.length; i < l; i += 1 ) {
        if ( sort[i].keyword === keyword ) {
            return true;
        }
    }
    return false;
};

const isSortedOnUnread = isSortedOnKeyword.bind( null, '$seen' );

const filterHasKeyword = function ( filter, keyword ) {
    return (
        keyword === filter.allInThreadHaveKeyword ||
        keyword === filter.someInThreadHaveKeyword ||
        keyword === filter.noneInThreadHaveKeyword ||
        keyword === filter.hasKeyword ||
        keyword === filter.notKeyword
    );
};

const isFilteredOnUnread = function ( filter ) {
    if ( filter.operator ) {
        return filter.conditions.some( isFilteredOnUnread );
    }
    return filterHasKeyword( filter, '$seen' );
};

const isFilteredOnKeyword = function ( keyword, filter ) {
    if ( filter.operator ) {
        return filter.conditions.some(
            isFilteredOnKeyword.bind( null, keyword )
        );
    }
    return filterHasKeyword( filter, keyword );
};

const isFilteredOnMailboxes = function ( filter ) {
    if ( filter.operator ) {
        return filter.conditions.some( isFilteredOnMailboxes );
    }
    return ( 'inMailbox' in filter ) || ( 'inMailboxOtherThan' in filter );
};

const isFilteredJustOnMailbox = function ( filter ) {
    var isJustMailboxes = false;
    var term;
    for ( term in filter ) {
        if ( term === 'inMailbox' ) {
            isJustMailboxes = true;
        } else {
            isJustMailboxes = false;
            break;
        }
    }
    return isJustMailboxes;
};
const returnTrue = function () {
    return true;
};
const returnFalse = function () {
    return false;
};

// ---

const getInboxId = function ( accountId ) {
    const inbox = getMailboxForRole( accountId, 'inbox' );
    return inbox ? inbox.get( 'id' ) : '';
};

const reOrFwd = /^(?:(?:re|fwd):\s*)+/;
const comparators = {
    id: function ( a, b ) {
        var aId = a.get( 'id' );
        var bId = b.get( 'id' );

        return aId < bId ? -1 : aId > bId ? 1 : 0;
    },
    receivedAt: function ( a, b ) {
        return a.get( 'receivedAt' ) - b.get( 'receivedAt' );
    },
    snoozedUntil: function ( a, b, field ) {
        var aSnoozed = a.get( 'snoozed' );
        var bSnoozed = b.get( 'snoozed' );
        var mailboxId = field.mailboxId;
        return (
            aSnoozed && ( !mailboxId || (
                a.isIn( 'snoozed' ) ||
                mailboxId === (
                    aSnoozed.moveToMailboxId ||
                    getInboxId( a.get( 'accountId' ) )
                )
            )) ?
                aSnoozed.until :
                a.get( 'receivedAt' )
        ) - (
            bSnoozed && ( !mailboxId || (
                b.isIn( 'snoozed' ) ||
                mailboxId === (
                    bSnoozed.moveToMailboxId ||
                    getInboxId( b.get( 'accountId' ) )
                )
            )) ?
                bSnoozed.until :
                b.get( 'receivedAt' )
        );
    },
    size: function ( a, b ) {
        return a.get( 'size' ) - b.get( 'size' );
    },
    from: function ( a, b ) {
        var aFrom = a.get( 'fromName' ) || a.get( 'fromEmail' );
        var bFrom = b.get( 'fromName' ) || b.get( 'fromEmail' );

        return aFrom < bFrom ? -1 : aFrom > bFrom ? 1 : 0;
    },
    to: function ( a, b ) {
        var aTo = a.get( 'to' );
        var bTo = b.get( 'to' );
        var aToPart = ( aTo && aTo.length &&
            ( aTo[0].name || aTo[0].email ) ) || '';
        var bToPart = ( bTo && bTo.length &&
            ( bTo[0].name || bTo[0].email ) ) || '';

        return aToPart < bToPart ? -1 : aTo > bToPart ? 1 : 0;
    },
    subject: function ( a, b ) {
        var aSubject = a.get( 'subject' ).replace( reOrFwd, '' );
        var bSubject = b.get( 'subject' ).replace( reOrFwd, '' );

        return aSubject < bSubject ? -1 : aSubject > bSubject ? 1 : 0;
    },
    hasKeyword: function ( a, b, field ) {
        var keyword = field.keyword;
        var aHasKeyword = !!a.get( 'keywords' )[ keyword ];
        var bHasKeyword = !!b.get( 'keywords' )[ keyword ];

        return aHasKeyword === bHasKeyword ? 0 :
            aHasKeyword ? 1 : -1;
    },
    someInThreadHaveKeyword: function ( a, b, field ) {
        var keyword = field.keyword;
        var hasKeyword = function ( message ) {
            return !!message.get( 'keywords' )[ keyword ];
        };
        var aThread = a.get( 'thread' );
        var bThread = b.get( 'thread' );
        var aMessages = aThread ? aThread.get( 'messages' ) : [ a ];
        var bMessages = bThread ? bThread.get( 'messages' ) : [ b ];
        var aHasKeyword = aMessages.some( hasKeyword );
        var bHasKeyword = bMessages.some( hasKeyword );

        return aHasKeyword === bHasKeyword ? 0 :
            aHasKeyword ? 1 : -1;
    },
};

const compareToStoreKey = function ( fields, storeKey, message ) {
    var otherMessage = storeKey && ( store.getStatus( storeKey ) & READY ) ?
            store.getRecordFromStoreKey( storeKey ) : null;
    var i, l, field, comparator, result;
    if ( !otherMessage ) {
        return 1;
    }
    for ( i = 0, l = fields.length; i < l; i += 1 ) {
        field = fields[i];
        comparator = comparators[ field.property ];
        if ( comparator &&
                ( result = comparator( otherMessage, message, field ) ) ) {
            if ( !field.isAscending ) {
                result = -result;
            }
            return result;
        }
    }
    return 0;
};

const compareToMessage = function ( fields, aData, bData ) {
    var a = aData.message;
    var b = bData.message;
    var i, l, field, comparator, result;
    for ( i = 0, l = fields.length; i < l; i += 1 ) {
        field = fields[i];
        comparator = comparators[ field.property ];
        if ( comparator && ( result = comparator( a, b, field ) ) ) {
            if ( !field.isAscending ) {
                result = -result;
            }
            return result;
        }
    }
    return 0;
};

const calculatePreemptiveAdd = function ( query, addedMessages, replaced ) {
    var storeKeys = query.getStoreKeys();
    var sort = query.get( 'sort' );
    var collapseThreads = query.get( 'collapseThreads' );
    var comparator = compareToStoreKey.bind( null, sort );
    var messageSKToIndex = {};
    var indexDelta = 0;
    var added, i, l, messageSK, threadSK, seenThreadSk, threadSKToIndex;

    added = addedMessages.reduce( function ( added, message ) {
        added.push({
            message: message,
            messageSK: message.get( 'storeKey' ),
            threadSK: collapseThreads ?
                message.getFromPath( 'thread.storeKey' ) :
                null,
            index: storeKeys.binarySearch( message, comparator ),
        });
        return added;
    }, [] );
    added.sort( compareToMessage.bind( null, sort ) );

    if ( !added.length ) {
        return added;
    }

    if ( collapseThreads ) {
        seenThreadSk = {};
        added = added.filter( function ( item ) {
            var threadSK = item.threadSK;
            if ( seenThreadSk[ threadSK ] ) {
                return false;
            }
            seenThreadSk[ threadSK ] = true;
            return true;
        });
        threadSKToIndex = {};
    }
    l = storeKeys.length;
    for ( i = 0; i < l; i += 1 ) {
        messageSK = storeKeys[i];
        if ( messageSK ) {
            if ( collapseThreads && ( store.getStatus( messageSK ) & READY ) ) {
                threadSK = store.getData( messageSK ).threadId;
                threadSKToIndex[ threadSK ] = i;
            }
            messageSKToIndex[ messageSK ] = i;
        }
    }

    return added.reduce( function ( result, item ) {
        var currentExemplarIndex = messageSKToIndex[ item.messageSK ];
        if ( item.threadSK && currentExemplarIndex === undefined ) {
            currentExemplarIndex = threadSKToIndex[ item.threadSK ];
        }
        if ( currentExemplarIndex !== undefined ) {
            if ( currentExemplarIndex >= item.index ) {
                replaced.push( storeKeys[ currentExemplarIndex ] );
            } else {
                return result;
            }
        }
        result.push({
            index: item.index + indexDelta,
            storeKey: item.messageSK,
        });
        indexDelta += 1;
        return result;
    }, [] );
};

const updateQueries = function ( filterTest, sortTest, deltas ) {
    // Set as obsolete any message list that is filtered by
    // one of the removed or added mailboxes. If it's a simple query,
    // pre-emptively update it.
    var queries = store.getAllQueries();
    var l = queries.length;
    var query, filter, sort, mailboxSK, delta, replaced, added;
    while ( l-- ) {
        query = queries[l];
        if ( query instanceof MessageList ) {
            filter = query.get( 'where' );
            sort = query.get( 'sort' );
            if ( deltas && isFilteredJustOnMailbox( filter ) ) {
                mailboxSK = store.getStoreKey(
                    query.get( 'accountId' ), Mailbox, filter.inMailbox );
                delta = deltas[ mailboxSK ];
                if ( delta ) {
                    replaced = [];
                    added =
                        calculatePreemptiveAdd( query, delta.added, replaced );
                    query.clientDidGenerateUpdate({
                        added: added,
                        removed: delta.removed,
                    });
                    if ( replaced.length ) {
                        query.clientDidGenerateUpdate({
                            added: [],
                            removed: replaced,
                        });
                    }
                }
            } else if ( filterTest( filter ) || sortTest( sort ) ) {
                query.setObsolete();
            }
        }
    }
};

// ---

const identity = function ( v ) { return v; };

const isSnoozedMailbox = function ( mailbox ) {
    return !!mailbox && mailbox.get( 'role' ) === 'snoozed';
};

const addMoveInverse = function ( inverse, undoManager, willAdd, willRemove, messageSK, wasSnoozed ) {
    var l = willRemove ? willRemove.length : 1;
    var i, addMailbox, removeMailbox, key, data;
    for ( i = 0; i < l; i += 1 ) {
        addMailbox = willAdd ? willAdd[0] : null;
        removeMailbox = willRemove ? willRemove[i] : null;
        key = ( addMailbox ? addMailbox.get( 'storeKey' ) : '-' ) +
            ( removeMailbox ? removeMailbox.get( 'storeKey' ) : '-' );
        data = inverse[ key ];
        if ( !data ) {
            data = {
                method: 'move',
                messageSKs: [],
                args: [ null, removeMailbox, addMailbox, true, {} ],
            };
            inverse[ key ] = data;
            undoManager.pushUndoData( data );
        }
        data.messageSKs.push( messageSK );
        if ( wasSnoozed ) {
            data.args[4][ messageSK ] = wasSnoozed;
        }
        willAdd = null;
    }
};

// Sets snooze details and returns old details if set and different to new.
// snooze can be a SnoozeDetails object or a map of store key -> SnoozeDetails.
const setSnoozed = function ( message, newSnoozed ) {
    var oldSnoozed = message.get( 'snoozed' );
    if ( !isEqual( oldSnoozed, newSnoozed ) ) {
        message.set( 'snoozed', newSnoozed );
        return oldSnoozed;
    }
    return null;
};

const isSnoozeRemoved = function ( willRemove, snoozed ) {
    if ( !snoozed || !willRemove ) {
        return false;
    }
    var moveToMailboxId = snoozed.moveToMailboxId;
    return willRemove.some( moveToMailboxId ?
        ( mailbox => (
            mailbox.get( 'role' ) === 'snoozed' ||
            mailbox.get( 'id' ) === moveToMailboxId ) ) :
        ( mailbox => (
            mailbox.get( 'role' ) === 'snoozed' ||
            mailbox.get( 'role' ) === 'inbox' ) )
    );
};

// ---

const NO = 0;
const TO_MAILBOX = 1;
const TO_THREAD_IN_NOT_TRASH = 2;
const TO_THREAD_IN_TRASH = 4;
const TO_THREAD = (TO_THREAD_IN_NOT_TRASH|TO_THREAD_IN_TRASH);

const getMessages = function getMessages ( messageSKs, expand, mailbox, callback, hasDoneLoad ) {
    // Map to threads, then make sure all threads, including headers
    // are loaded
    var allLoaded = true;
    var messages = [];

    var checkMessage = function ( message ) {
        if ( message.is( READY ) ) {
            if ( expand === TO_MAILBOX && mailbox ) {
                if ( message.get( 'mailboxes' ).contains( mailbox ) ) {
                    messages.push( message );
                }
            } else if ( expand & TO_THREAD ) {
                if ( (( expand & TO_THREAD_IN_NOT_TRASH ) &&
                        message.get( 'isInNotTrash' )) ||
                     (( expand & TO_THREAD_IN_TRASH ) &&
                        message.get( 'isInTrash' )) ) {
                    messages.push( message );
                }
            } else {
                messages.push( message );
            }
        } else {
            allLoaded = false;
        }
    };

    messageSKs.forEach( function ( messageSK ) {
        var thread, message;
        if ( expand ) {
            if ( store.getStatus( messageSK ) & READY ) {
                thread = store.getRecordFromStoreKey( messageSK )
                              .get( 'thread' );
                if ( thread && thread.is( READY ) ) {
                    thread.get( 'messages' ).forEach( checkMessage );
                } else {
                    allLoaded = false;
                }
            } else {
                // Fetch all messages in thread
                connection.fetchRecord(
                    store.getAccountIdFromStoreKey( messageSK ),
                    Message.Thread,
                    store.getIdFromStoreKey( messageSK ) );
                allLoaded = false;
            }
        } else {
            message = store.getRecordFromStoreKey( messageSK );
            checkMessage( message );
        }
    });

    if ( allLoaded || hasDoneLoad ) {
        connection.gc.isPaused = false;
        callback( messages );
    } else {
        // Suspend gc and wait for next API request: guaranteed to load
        // everything
        connection.gc.isPaused = true;
        connection.addCallback(
            getMessages.bind( null,
                messageSKs, expand, mailbox, callback, true )
        );
    }
    return true;
};

// ---

const doUndoAction = function ( method, args ) {
    return function ( callback, messages ) {
        if ( messages ) {
            args[0] = messages;
        }
        connection[ method ].apply( connection, args );
        callback( null );
    };
};

// ---

const roleIndex = new O.Object({
    index: null,
    clearIndex: function () {
        this.index = null;
    },
    buildIndex: function () {
        var index = this.index = store.getAll( Mailbox ).reduce(
            function ( index, mailbox ) {
                var accountId = mailbox.get( 'accountId' );
                var role = mailbox.get( 'role' );
                if ( role ) {
                    ( index[ accountId ] ||
                        ( index[ accountId ] = {} ) )[ role ] = mailbox;
                }
                return index;
            }, {} );
        return index;
    },
    getIndex: function () {
        return this.index || this.buildIndex();
    },
});
store.on( Mailbox, roleIndex, 'clearIndex' );

const getMailboxForRole = function ( accountId, role, createWithProps ) {
    if ( !accountId ) {
        accountId = auth.get( 'primaryAccounts' )[ auth.MAIL_DATA ];
    }
    var accountIndex = roleIndex.getIndex()[ accountId ];
    var mailbox = accountIndex && accountIndex[ role ] || null;
    if ( !mailbox && createWithProps ) {
        // The other role names are not localised over IMAP, so I guess
        // we don't with this one either?
        var name = role.capitalise();
        var nameClashes = store.getAll( Mailbox, data =>
            data.accountId === accountId &&
            !data.parentId &&
            data.name.startsWith( name )
        ).reduce( ( nameClashes, mailbox ) => {
            var name = mailbox.get( 'name' );
            nameClashes[ name ] = mailbox;
            return nameClashes;
        }, {} );
        var index, property;
        mailbox = nameClashes[ name ];
        if ( mailbox ) {
            index = 2;
            while ( nameClashes[ name + ' ' + index ] ) {
                index += 1;
            }
            mailbox.set( 'name', name + ' ' + index );
        }
        mailbox = new Mailbox( store )
            .set( 'role', role )
            .set( 'name', name );
        for ( property in createWithProps ) {
            mailbox.set( property, createWithProps[ property ] );
        }
        mailbox.saveToStore();
    }
    return mailbox;
};

// ---

const logACLsError = function ( type, mailbox ) {
    var name = mailbox.get( 'name' );
    O.RunLoop.didError({
        name: 'JMAP.mail.move',
        message: 'May not ' + type + ' messages in ' + name,
        details: {
            status: mailbox.get( 'status' ),
            myRights: mailbox.get( 'myRights' ),
        },
    });
};

Object.assign( connection, {

    NO: NO,
    TO_MAILBOX: TO_MAILBOX,
    TO_THREAD_IN_NOT_TRASH: TO_THREAD_IN_NOT_TRASH,
    TO_THREAD_IN_TRASH: TO_THREAD_IN_TRASH,
    TO_THREAD: TO_THREAD,

    getMessages: getMessages,

    getMailboxForRole: getMailboxForRole,

    // ---

    findMessage: function ( accountId, where ) {
        return new Promise( function ( resolve, reject ) {
            connection.callMethod( 'Email/query', {
                accountId: accountId,
                filter: where,
                sort: null,
                position: 0,
                limit: 1,
            }, function ( responseArgs, responseName ) {
                var id;
                if ( responseName === 'Email/query' ) {
                    id = responseArgs.ids[0];
                    if ( id ) {
                        resolve( store.getRecord( accountId, Message, id ) );
                    } else {
                        reject({
                            type: 'notFound',
                        });
                    }
                } else {
                    reject( responseArgs );
                }
            }).callMethod( 'Email/get', {
                accountId: accountId,
                '#ids': {
                    resultOf: connection.getPreviousMethodId(),
                    name: 'Email/query',
                    path: '/ids',
                },
                properties: Message.headerProperties,
            });
        });
    },

    // ---

    gc: new O.MemoryManager( store, [
        {
            Type: Message,
            max: 1200
        },
        {
            Type: Thread,
            max: 1000
        },
        {
            Type: MessageList,
            max: 5,
            // This is really needed to check for disappearing Messages/Threads,
            // but more efficient to run it here.
            afterCleanup: function () {
                var queries = store.getAllQueries();
                var l = queries.length;
                var query;
                while ( l-- ) {
                    query = queries[l];
                    if ( query instanceof MessageList ) {
                        query.recalculateFetchedWindows();
                    }
                }
            }
        }
    ], 60000 ),

    undoManager: new O.UndoManager({

        store: store,

        maxUndoCount: 10,

        pending: [],
        sequence: null,

        getUndoData: function () {
            var data = this.pending;
            if ( data.length ) {
                this.pending = [];
            } else {
                data = null;
            }
            return data;
        },

        pushUndoData: function ( data ) {
            this.pending.push( data );
            if ( !this.get( 'sequence' ) ) {
                this.dataDidChange();
            }
            return data;
        },

        applyChange: function ( data ) {
            var pending = this.pending;
            var sequence = new JMAP.Sequence();
            var l = data.length;
            var call, messageSKs;

            while ( l-- ) {
                call = data[l];
                messageSKs = call.messageSKs;
                if ( messageSKs ) {
                    sequence.then(
                        getMessages.bind( null, messageSKs, NO, null ) );
                }
                sequence.then( doUndoAction( call.method, call.args ) );
            }

            sequence.afterwards = function () {
                this.set( 'sequence', null );
                if ( !pending.length ) {
                    var redoStack = this._redoStack;
                    if ( redoStack.last() === pending ) {
                        redoStack.pop();
                        this.set( 'canRedo', !!redoStack.length );
                    }
                    // This could get called synchronously before applyChange
                    // returns depending on the undoAction; set pending to null
                    // to ensure we don't add a noop to the redo stack.
                    pending = null;
                }
                this.pending = [];
            }.bind( this );

            this.set( 'sequence', sequence );

            sequence.go( null );

            return pending;
        }
    }),

    // ---

    setUnread: function ( messages, isUnread, allowUndo ) {
        var mailboxDeltas = {};
        var inverseMessageSKs = allowUndo ? [] : null;
        var inverse = allowUndo ? {
                method: 'setUnread',
                messageSKs: inverseMessageSKs,
                args: [
                    null,
                    !isUnread,
                    true
                ]
            } : null;

        messages.forEach( function ( message ) {
            // Check we have something to do
            if ( message.get( 'isUnread' ) === isUnread ||
                    !message.hasPermission( 'maySetSeen' ) ) {
                return;
            }

            // Get the thread and cache the current unread state
            var thread = message.getThreadIfReady();
            var isInTrash = message.get( 'isInTrash' );
            var isInNotTrash = message.get( 'isInNotTrash' );
            var threadUnreadInTrash =
                isInTrash && thread && thread.get( 'isUnreadInTrash' ) ?
                1 : 0;
            var threadUnreadInNotTrash =
                isInNotTrash && thread && thread.get( 'isUnreadInNotTrash' ) ?
                1 : 0;
            var mailboxCounts, mailboxSK, mailbox, delta, unreadDelta;

            // Update the message
            message.set( 'isUnread', isUnread );

            // Add inverse for undo
            if ( allowUndo ) {
                inverseMessageSKs.push( message.get( 'storeKey' ) );
            }

            // Draft messages unread status don't count in mailbox unread counts
            if ( message.get( 'isDraft' ) ) {
                return;
            }

            // Calculate any changes to the mailbox unread message counts
            message.get( 'mailboxes' ).forEach( function ( mailbox ) {
                var mailboxSK = mailbox.get( 'storeKey' );
                var delta = getMailboxDelta( mailboxDeltas, mailboxSK );
                delta.unreadEmails += isUnread ? 1 : -1;
            });

            // See if the thread unread state has changed
            if ( isInTrash && thread ) {
                threadUnreadInTrash =
                    Number( thread.get( 'isUnreadInTrash' ) ) -
                        threadUnreadInTrash;
            }
            if ( isInNotTrash && thread ) {
                threadUnreadInNotTrash =
                    Number( thread.get( 'isUnreadInNotTrash' ) ) -
                        threadUnreadInNotTrash;
            }

            // Calculate any changes to the mailbox unread thread counts
            if ( threadUnreadInNotTrash || threadUnreadInTrash ) {
                mailboxCounts = thread.get( 'mailboxCounts' );
                for ( mailboxSK in mailboxCounts ) {
                    mailbox = store.getRecordFromStoreKey( mailboxSK );
                    unreadDelta = mailbox.get( 'role' ) === 'trash' ?
                        threadUnreadInTrash : threadUnreadInNotTrash;
                    if ( unreadDelta ) {
                        delta = getMailboxDelta( mailboxDeltas, mailboxSK );
                        delta.unreadThreads += unreadDelta;
                    }
                }
            }
        });

        // Update counts on mailboxes
        updateMailboxCounts( mailboxDeltas );

        // Update message list queries, or mark in need of refresh
        updateQueries( isFilteredOnUnread, isSortedOnUnread, null );

        if ( allowUndo && inverseMessageSKs.length ) {
            this.undoManager.pushUndoData( inverse );
        }

        return this;
    },

    setKeyword: function ( messages, keyword, value, allowUndo ) {
        var inverseMessageSKs = allowUndo ? [] : null;
        var inverse = allowUndo ? {
                method: 'setKeyword',
                messageSKs: inverseMessageSKs,
                args: [
                    null,
                    keyword,
                    !value,
                    true
                ]
            } : null;

        messages.forEach( function ( message ) {
            // Check we have something to do
            if ( !!message.get( 'keywords' )[ keyword ] === value ||
                    !message.hasPermission( 'maySetKeywords' ) ) {
                return;
            }

            // Update the message
            message.setKeyword( keyword, value );

            // Add inverse for undo
            if ( allowUndo ) {
                inverseMessageSKs.push( message.get( 'storeKey' ) );
            }
        });

        // Update message list queries, or mark in need of refresh
        updateQueries(
            isFilteredOnKeyword.bind( null, keyword ),
            isSortedOnKeyword.bind( null, keyword ),
            null
        );

        if ( allowUndo && inverseMessageSKs.length ) {
            this.undoManager.pushUndoData( inverse );
        }

        return this;
    },

    move: function ( messages, addMailbox, removeMailbox, allowUndo, snoozed ) {
        var mailboxDeltas = {};
        var inverse = allowUndo ? {} : null;
        var removeAll = removeMailbox === 'ALL';
        var undoManager = this.undoManager;
        var addMailboxOnlyIfNone = false;
        var isAddingToSnoozed = isSnoozedMailbox( addMailbox );
        var toCopy = {};
        var now = FASTMAIL && ( new Date().toJSON() + 'Z' );
        var accountId, fromAccountId, mailboxIds;

        if ( !addMailbox ) {
            addMailboxOnlyIfNone = true;
            accountId = messages.length ?
                messages[0].get( 'accountId' ) : null;
            addMailbox =
                getMailboxForRole( accountId, 'archive' ) ||
                getMailboxForRole( accountId, 'inbox' );
        } else {
            accountId = addMailbox.get( 'accountId' );
        }
        if ( removeAll ) {
            removeMailbox = null;
        }

        // Check we're not moving from/to the same place
        if ( addMailbox === removeMailbox && !addMailboxOnlyIfNone ) {
            return this;
        }

        // Check ACLs
        if ( addMailbox && ( !addMailbox.is( READY ) ||
                !addMailbox.get( 'myRights' ).mayAddItems ) ) {
            logACLsError( 'add', addMailbox );
            return this;
        }
        if ( removeMailbox && ( !removeMailbox.is( READY ) ||
                !removeMailbox.get( 'myRights' ).mayRemoveItems ) ) {
            logACLsError( 'remove', removeMailbox );
            return this;
        }

        // Can't move to snoozed mailbox without snooze details
        if ( isAddingToSnoozed && !snoozed ) {
            return this;
        }

        messages.forEach( function ( message ) {
            var messageSK = message.get( 'storeKey' );
            var mailboxes = message.get( 'mailboxes' );
            var messageAccountId = message.get( 'accountId' );

            // Calculate the set of mailboxes to add/remove
            var willAdd = addMailbox && [ addMailbox ];
            var willRemove = null;
            var mailboxToRemoveIndex = -1;
            var alreadyHasMailbox = false;

            var wasThreadUnreadInNotTrash = false;
            var wasThreadUnreadInTrash = false;
            var isThreadUnreadInNotTrash = false;
            var isThreadUnreadInTrash = false;
            var mailboxCounts = null;

            var wasSnoozed = null;
            var newSnoozed = snoozed && !( snoozed instanceof SnoozeDetails ) ?
                snoozed[ message.get( 'storeKey' ) ] || null :
                snoozed || null;

            var isUnread, thread;
            var deltaThreadUnreadInNotTrash, deltaThreadUnreadInTrash;
            var decrementMailboxCount, incrementMailboxCount;
            var delta, mailboxSK, mailbox, removedDates;

            // Calculate the changes required to the message's mailboxes
            if ( removeAll ) {
                willRemove = mailboxes.map( identity );
                mailboxToRemoveIndex = 0;
                alreadyHasMailbox = mailboxes.contains( addMailbox );
                if ( alreadyHasMailbox && willRemove.length === 1 ) {
                    willRemove = willAdd = null;
                }
            } else {
                mailboxes.forEach( function ( mailbox, index ) {
                    if ( mailbox === addMailbox ) {
                        willAdd = null;
                    }
                    if ( mailbox === removeMailbox ) {
                        willRemove = [ mailbox ];
                        mailboxToRemoveIndex = index;
                    }
                });
            }

            // Check we have something to do
            if ( !willRemove && ( !willAdd || addMailboxOnlyIfNone ) ) {
                // We may be updating snooze but not moving
                if ( isAddingToSnoozed && newSnoozed ) {
                    wasSnoozed = setSnoozed( message, newSnoozed );
                    if ( allowUndo && wasSnoozed ) {
                        addMoveInverse(
                            inverse,
                            undoManager,
                            addMailbox,
                            null,
                            messageSK,
                            wasSnoozed
                        );
                    }
                }
                return;
            }

            if ( addMailboxOnlyIfNone ) {
                if ( willRemove.length !== mailboxes.get( 'length' ) ) {
                    willAdd = null;
                } else if ( !willAdd ) {
                    // Can't remove from everything without adding
                    return;
                }
            }

            // Get the thread and cache the current unread state
            isUnread = message.get( 'isUnread' ) && !message.get( 'isDraft' );
            thread = message.getThreadIfReady();
            if ( thread ) {
                wasThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
                wasThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );
            }

            // Handle moving cross-account
            if ( willAdd && messageAccountId !== accountId ) {
                if ( removeAll ||
                        ( willRemove && mailboxes.get( 'length' ) === 1 ) ) {
                    // Removing all existing mailboxes.
                    // Preemptively remove it from the thread
                    if ( thread ) {
                        thread.get( 'messages' ).remove( message );
                        thread.fetch();
                    }
                    // And move to new account id.
                    message = message.set( 'accountId', accountId );
                } else {
                    // Otherwise, we need to copy.
                    ( toCopy[ messageAccountId ] ||
                        ( toCopy[ messageAccountId ] = [] ) ).push( message );
                    if ( willRemove ) {
                        willAdd = null;
                    } else {
                        return;
                    }
                }
            }

            // Update the message
            mailboxes.replaceObjectsAt(
                willRemove ? mailboxToRemoveIndex : mailboxes.get( 'length' ),
                willRemove ? willRemove.length : 0,
                willAdd
            );
            if ( willRemove ) {
                if ( FASTMAIL ) {
                    removedDates = clone( message.get( 'removedDates' ) );
                    willRemove.forEach( mailbox => {
                        removedDates[ mailbox.get( 'id' ) ] = now;
                    });
                    message.set( 'removedDates', removedDates );
                }
            }

            if ( alreadyHasMailbox ) {
                willAdd = null;
                willRemove.erase( addMailbox );
            }

            // Set snoozed if given; clear snooze if removing from
            // mailbox target of snooze and not still in Snoozed mailbox.
            if ( newSnoozed ) {
                wasSnoozed = setSnoozed( message, newSnoozed );
            } else if ( !message.isIn( 'snoozed' ) &&
                    isSnoozeRemoved( willRemove, message.get( 'snoozed' ) ) ) {
                wasSnoozed = setSnoozed( message, null );
            }

            // Add inverse for undo
            if ( allowUndo ) {
                addMoveInverse( inverse, undoManager,
                    // Don't use messageSK, because we need the new store key
                    // if we moved it to a new account
                    willAdd, willRemove, message.get( 'storeKey' ),
                    wasSnoozed );
            }

            // Calculate any changes to the mailbox message counts
            if ( thread ) {
                isThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
                isThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );
                mailboxCounts = thread.get( 'mailboxCounts' );
            }

            decrementMailboxCount = function ( mailbox ) {
                var mailboxSK = mailbox.get( 'storeKey' );
                var delta = getMailboxDelta( mailboxDeltas, mailboxSK );
                delta.removed.push( messageSK );
                delta.totalEmails -= 1;
                if ( isUnread ) {
                    delta.unreadEmails -= 1;
                }
                // If this was the last message in the thread in the mailbox
                if ( thread && !mailboxCounts[ mailboxSK ] ) {
                    delta.totalThreads -= 1;
                    if ( mailbox.get( 'role' ) === 'trash' ?
                            wasThreadUnreadInTrash :
                            wasThreadUnreadInNotTrash ) {
                        delta.unreadThreads -= 1;
                    }
                }
            };
            incrementMailboxCount = function ( mailbox ) {
                var mailboxSK = mailbox.get( 'storeKey' );
                var delta = getMailboxDelta( mailboxDeltas, mailboxSK );
                // Don't pre-emptively add to any queries when moving
                // cross-account. The thread reference will change, but this is
                // an immutable property so you don't want a view to render
                // thinking the message is READY and then have it change.
                if ( messageAccountId === accountId ) {
                    delta.added.push( message );
                }
                delta.totalEmails += 1;
                if ( isUnread ) {
                    delta.unreadEmails += 1;
                }
                // If this was the first message in the thread in the
                // mailbox
                if ( thread && mailboxCounts[ mailboxSK ] === 1 ) {
                    delta.totalThreads += 1;
                    if ( mailbox.get( 'role' ) === 'trash' ?
                            isThreadUnreadInTrash : isThreadUnreadInNotTrash ) {
                        delta.unreadThreads += 1;
                    }
                }
            };

            if ( willRemove ) {
                willRemove.forEach( decrementMailboxCount );
            }
            if ( willAdd ) {
                willAdd.forEach( incrementMailboxCount );
            }

            // If the thread unread state has changed (due to moving in/out of
            // trash), we might need to update mailboxes that the messages is
            // not in now and wasn't in before!
            // We need to adjust the count for any mailbox that hasn't already
            // been updated above. This means it must either:
            // 1. Have more than 1 message in the thread in it; or
            // 2. Not have been in the set of mailboxes we just added to this
            //    message
            deltaThreadUnreadInNotTrash =
                ( isThreadUnreadInNotTrash ? 1 : 0 ) -
                ( wasThreadUnreadInNotTrash ? 1 : 0 );
            deltaThreadUnreadInTrash =
                ( isThreadUnreadInTrash ? 1 : 0 ) -
                ( wasThreadUnreadInTrash ? 1 : 0 );

            if ( deltaThreadUnreadInNotTrash || deltaThreadUnreadInTrash ) {
                for ( mailboxSK in mailboxCounts ) {
                    mailbox = store.getRecordFromStoreKey( mailboxSK );
                    if ( mailboxCounts[ mailboxSK ] > 1 ||
                            !willAdd.contains( mailbox ) ) {
                        delta = getMailboxDelta( mailboxDeltas, mailboxSK );
                        if ( mailbox.get( 'role' ) === 'trash' ) {
                            delta.unreadThreads += deltaThreadUnreadInTrash;
                        } else {
                            delta.unreadThreads += deltaThreadUnreadInNotTrash;
                        }
                    }
                }
            }
        });

        // Copy if necessary
        for ( fromAccountId in toCopy ) {
            mailboxIds = {};
            mailboxIds[ addMailbox.toIdOrStoreKey() ] = true;
            this.callMethod( 'Email/copy', {
                fromAccountId: fromAccountId,
                accountId: accountId,
                create: toCopy[ fromAccountId ].reduce(
                    function ( map, message, index ) {
                        map[ 'copy' + index ] = {
                            id: message.get( 'id' ),
                            mailboxIds: mailboxIds,
                            keywords: message.get( 'keywords' ),
                        };
                        return map;
                    }, {} ),
            });
        }
        if ( Object.keys( toCopy ).length ) {
            // If we copied something, we need to fetch the changes manually
            // as we don't track this ourselves.
            store
                .fetchAll( accountId, Mailbox, true )
                .fetchAll( accountId, Thread, true )
                .fetchAll( accountId, Message, true );
        }

        // Update counts on mailboxes
        updateMailboxCounts( mailboxDeltas );

        // Update message list queries, or mark in need of refresh
        updateQueries( isFilteredOnMailboxes, returnFalse, mailboxDeltas );

        return this;
    },

    destroy: function ( messages ) {
        var mailboxDeltas = {};

        messages.forEach( function ( message ) {
            var messageSK = message.get( 'storeKey' );
            var mailboxes = message.get( 'mailboxes' );

            var wasThreadUnreadInNotTrash = false;
            var wasThreadUnreadInTrash = false;
            var isThreadUnreadInNotTrash = false;
            var isThreadUnreadInTrash = false;
            var mailboxCounts = null;

            var isUnread, thread;
            var deltaThreadUnreadInNotTrash, deltaThreadUnreadInTrash;
            var delta, mailboxSK, mailbox, messageWasInMailbox, isTrash;

            // Get the thread and cache the current unread state
            isUnread = message.get( 'isUnread' ) && !message.get( 'isDraft' );
            thread = message.getThreadIfReady();
            if ( thread ) {
                mailboxCounts = thread.get( 'mailboxCounts' );
                wasThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
                wasThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );
            }

            // Update the message
            message.destroy();

            if ( thread ) {
                // Preemptively update the thread
                thread.get( 'messages' ).remove( message );
                thread.fetch();

                // Calculate any changes to the mailbox message counts
                isThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
                isThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );

                deltaThreadUnreadInNotTrash =
                    ( isThreadUnreadInNotTrash ? 1 : 0 ) -
                    ( wasThreadUnreadInNotTrash ? 1 : 0 );
                deltaThreadUnreadInTrash =
                    ( isThreadUnreadInTrash ? 1 : 0 ) -
                    ( wasThreadUnreadInTrash ? 1 : 0 );

                for ( mailboxSK in mailboxCounts ) {
                    mailbox = store.getRecordFromStoreKey( mailboxSK );
                    messageWasInMailbox = mailboxes.contains( mailbox );
                    isTrash = mailbox.get( 'role' ) === 'trash';
                    if ( messageWasInMailbox ) {
                        delta = getMailboxDelta( mailboxDeltas, mailboxSK );
                        delta.totalEmails -= 1;
                        if ( isUnread ) {
                            delta.unreadEmails -= 1;
                        }
                        delta.removed.push( messageSK );
                        if ( mailboxCounts[ mailboxSK ] === 1 ) {
                            delta.totalThreads -= 1;
                        }
                    }
                    if ( isTrash && deltaThreadUnreadInTrash ) {
                        getMailboxDelta( mailboxDeltas, mailboxSK )
                            .unreadThreads += deltaThreadUnreadInTrash;
                    } else if ( !isTrash && deltaThreadUnreadInNotTrash ) {
                        getMailboxDelta( mailboxDeltas, mailboxSK )
                            .unreadThreads += deltaThreadUnreadInNotTrash;
                    }
                }
            } else {
                mailboxes.forEach( function ( mailbox ) {
                    var delta = getMailboxDelta(
                        mailboxDeltas, mailbox.get( 'storeKey' ) );
                    delta.totalEmails -= 1;
                    if ( isUnread ) {
                        delta.unreadEmails -= 1;
                    }
                    delta.removed.push( messageSK );
                });
            }
        });

        // Update counts on mailboxes
        updateMailboxCounts( mailboxDeltas );

        // Update message list queries, or mark in need of refresh
        updateQueries( returnTrue, returnFalse, mailboxDeltas );

        return this;
    },

    report: function ( messages, asSpam, allowUndo ) {
        var messageSKs = [];
        var accounts = {};
        var accountId;

        messages.forEach( function ( message ) {
            var accountId = message.get( 'accountId' );
            var account = accounts[ accountId ] ||
                ( accounts[ accountId ] = [] );
            account.push( message.get( 'id' ) );
            messageSKs.push( message.get( 'storeKey' ) );
        });

        for ( accountId in accounts ) {
            this.callMethod( 'Email/report', {
                accountId: accountId,
                ids: accounts[ accountId ],
                type: asSpam ? 'spam' : 'notspam',
            });
        }

        if ( allowUndo ) {
            this.undoManager.pushUndoData({
                method: 'report',
                messageSKs: messageSKs,
                args: [
                    null,
                    !asSpam,
                    true
                ],
            });
        }

        return this;
    },

    // ---

    create: function ( message ) {
        var thread = message.getThreadIfReady();
        var mailboxes = message.get( 'mailboxes' );
        var wasThreadUnreadInNotTrash = false;
        var wasThreadUnreadInTrash = false;
        var isThreadUnreadInNotTrash = false;
        var isThreadUnreadInTrash = false;
        var deltaThreadUnreadInTrash = false;
        var deltaThreadUnreadInNotTrash = false;
        var isDraft = message.get( 'isDraft' );
        var isUnread = !isDraft && message.get( 'isUnread' );
        var mailboxDeltas = {};
        var mailboxCounts = null;
        var mailboxSK, mailbox, isTrash;

        // Cache the current thread state
        if ( thread ) {
            mailboxCounts = thread.get( 'mailboxCounts' );
            wasThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
            wasThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );
        }

        // If not in any mailboxes, make it a draft
        if ( mailboxes.get( 'length' ) === 0 ) {
            message
                .set( 'isDraft', true )
                .set( 'isUnread', false );
            mailboxes.add(
                getMailboxForRole( message.get( 'accountId' ), 'drafts' ) ||
                getMailboxForRole( null, 'drafts' )
            );
        }

        // Create the message
        message.saveToStore();

        if ( mailboxCounts ) {
            // Preemptively update the thread
            var messages = thread.get( 'messages' );
            var l = messages.get( 'length' );
            var receivedAt = message.get( 'receivedAt' );
            while ( l-- ) {
                if ( receivedAt >=
                        messages.getObjectAt( l ).get( 'receivedAt' ) ) {
                    break;
                }
            }
            messages.replaceObjectsAt( l + 1, 0, [ message ] );
            thread.fetch();

            // Calculate any changes to the mailbox message counts
            isThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
            isThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );

            deltaThreadUnreadInNotTrash =
                ( isThreadUnreadInNotTrash ? 1 : 0 ) -
                ( wasThreadUnreadInNotTrash ? 1 : 0 );
            deltaThreadUnreadInTrash =
                ( isThreadUnreadInTrash ? 1 : 0 ) -
                ( wasThreadUnreadInTrash ? 1 : 0 );
        }

        mailboxes.forEach( function ( mailbox ) {
            var mailboxSK = mailbox.get( 'storeKey' );
            var delta = getMailboxDelta( mailboxDeltas, mailboxSK );
            delta.added.push( message );
            delta.totalEmails += 1;
            if ( isUnread ) {
                delta.unreadEmails += 1;
            }
            if ( mailboxCounts && !mailboxCounts[ mailboxSK ] ) {
                delta.totalThreads += 1;
                if ( mailbox.get( 'role' ) === 'trash' ?
                        isThreadUnreadInTrash : isThreadUnreadInNotTrash ) {
                    delta.unreadThreads += 1;
                }
            }
        });

        for ( mailboxSK in mailboxCounts ) {
            mailbox = store.getRecordFromStoreKey( mailboxSK );
            isTrash = mailbox.get( 'role' ) === 'trash';
            if ( !mailboxes.contains( mailbox ) ) {
                if ( isTrash && deltaThreadUnreadInTrash ) {
                    getMailboxDelta( mailboxDeltas, mailboxSK )
                        .unreadThreads += deltaThreadUnreadInTrash;
                } else if ( !isTrash && deltaThreadUnreadInNotTrash ) {
                    getMailboxDelta( mailboxDeltas, mailboxSK )
                        .unreadThreads += deltaThreadUnreadInNotTrash;
                }
            }
        }

        // Update counts on mailboxes
        updateMailboxCounts( mailboxDeltas );

        // Update message list queries, or mark in need of refresh
        updateQueries( returnTrue, returnFalse, mailboxDeltas );

        return this;
    },

    // ---

    redirect: function ( messages, to ) {
        var envelope = {
            mailFrom: {
                email: auth.get( 'username' ),
                parameters: {
                    resent: null,
                },
            },
            rcptTo: to.map( function ( address ) {
                return {
                    email: address.email,
                    parameters: null,
                };
            }),
        };

        return messages.map( function ( message ) {
            return new MessageSubmission( store )
                .set( 'accountId', message.get( 'accountId' ) )
                .set( 'identity', null )
                .set( 'message', message )
                .set( 'envelope', envelope )
                .saveToStore();
        });
    },
});

}( JMAP ) );
