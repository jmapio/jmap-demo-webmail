/*global console, setTimeout, clearTimeout, window */
"use strict";

( function () {

var API = {
    getMailboxes: function ( results, args ) {
        results.push(['mailboxes', {
            accountId: '1',
            state: 'asdf',
            list: [
                {
                    id: 'm1',
                    name: 'Inbox',
                    role: 'inbox',
                    parentId: null,
                    sortOrder: 0,
                    totalMessages: 23,
                    unreadMessages: 8,
                    totalThreads: 23,
                    unreadThreads: 8
                },
                {
                    id: 'm-outbox',
                    name: 'Outbox',
                    role: 'outbox',
                    parentId: null,
                    sortOrder: 1,
                    totalMessages: 0,
                    unreadMessages: 0,
                    totalThreads: 0,
                    unreadThreads: 0
                },
                {
                    id: 'm2',
                    name: 'Drafts',
                    role: 'drafts',
                    parentId: null,
                    sortOrder: 2,
                    totalMessages: 142,
                    unreadMessages: 0,
                    totalThreads: 142,
                    unreadThreads: 0
                },
                {
                    id: 'm3',
                    name: 'Sent',
                    role: 'sent',
                    parentId: null,
                    sortOrder: 5,
                    totalMessages: 144,
                    unreadMessages: 5,
                    totalThreads: 144,
                    unreadThreads: 5
                },
                {
                    id: 'm4',
                    name: 'Archive',
                    role: 'archive',
                    parentId: null,
                    sortOrder: 1,
                    totalMessages: 24,
                    unreadMessages: 0,
                    totalThreads: 24,
                    unreadThreads: 0
                },
                {
                    id: 'm5',
                    name: 'Trash',
                    role: 'trash',
                    parentId: null,
                    sortOrder: 20,
                    totalMessages: 2,
                    unreadMessages: 0,
                    totalThreads: 2,
                    unreadThreads: 0
                },
                {
                    id: 'm6',
                    name: 'Spam',
                    role: 'spam',
                    parentId: null,
                    sortOrder: 10,
                    totalMessages: 1,
                    unreadMessages: 4,
                    totalThreads: 1,
                    unreadThreads: 4
                }
            ],
            notFound: null
        }]);
    },
    setMailboxes: function ( results, args ) {
        var create = Object.keys( args.create );
        results.push(['mailboxesSet', {
            created: Object.zip( create,
                ( function ( l, arr ) {
                    if ( l-- ) {
                        arr.push( 'm' + Date.now() + '-' + l );
                    }
                    return arr;
                }( create.length, [] ) ) ),
            changed: Object.keys( args.update ),
            destroyed: Object.keys( args.destroy )
        }]);
    },
    getMessageList: function ( results, args ) {
        var result = [];
        var start = args.anchor ? parseInt( args.anchor.slice( 3 ), 10 ) : NaN;
        if ( isNaN( start ) ) {
            start = args.position;
        } else {
            start /= 2;
            start += args.anchorOffset;
        }
        for ( var i = start, l = i + args.limit; i < l; i += 1 ) {
            result.push( 'msg' + 2*i );
        }
        results.push(['messageList', {
            filter: args.filter,
            sort: args.sort,
            collapseThreads: args.collapseThreads,
            state: 'u123v42',
            canCalculateUpdates: true,
            position: start,
            total: 100,
            messageIds: result,
            threadIds: result
        }]);

        if ( args.fetchThreads ) {
            this.getThreads( results, {
                ids: result,
                fetchMessages: args.fetchMessages,
                fetchMessageProperties: args.fetchMessageProperties
            });
        } else if ( args.fetchMessages ) {
            this.getMessages( results, {
                ids: result,
                properties: args.fetchMessageProperties
            });
        }
    },
    getMessageListUpdates: function () {},
    getSearchSnippets: function ( results, args ) {
        var snippets = args.messageIds.map( function ( id ) {
            return {
                messageId: id,
                subject: Math.random() > 0.8 ?
                    'This is a <b>search</b> subject' : '',
                preview: Math.random() > 0.5 ?
                    'This is a <b>search</b> snippet, but <b>there</b> may be other results' : ''
            };
        });
        results.push(['searchSnippets', {
            filter: args.filter,
            list: snippets,
            notFound: null
        }]);
    },
    getThreads: function ( results, args ) {
        results.push(['threads', {
            state: 'u123v42',
            list: args.ids.map( function ( id ) {
                return {
                    id: id,
                    messageIds: [ id, id + '-2', id + '-3' ]
                };
            }),
            notFound: null
        }]);
        if ( args.fetchMessages ) {
            this.getMessages( results, {
                ids: args.ids.reduce( function ( arr, id ) {
                    arr.push( id, id + '-2', id + '-3' );
                    return arr;
                }, [] ),
                properties: args.fetchMessageProperties
            });
        }
    },
    getMessages: function ( results, args ) {
        var list = args.ids,
            result = [];
        for ( var i = 0, l = list.length; i < l; i += 1 ) {
            args.properties[0] === 'threadId' ? result.push({
                id: list[i],
                threadId: list[i].replace( /\-\d$/, '' ),
                mailboxIds: [ 'm1' ],
                isDraft: false,
                isUnread: false,
                isFlagged: false,
                isAnswered: Math.random() > 0.8,
                hasAttachment: Math.random() > 0.8,
                date: new Date(
                    Date.now() - ~~( Math.random() * 10000000000 ) ).toJSON(),
                subject: 'The sophisticated subject',
                from: [{name: 'Arthur Dent', email: 'arthur@example.com'}],
                to: [ {name: 'Ford Prefect', email: 'ford@example.com'},
                    {name: 'Trillian McMillan', email: 'trills@example.com'} ],
                size: ~~( Math.random() * Math.random() * 100000 ),
                preview: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim adminim'
            }) :
            result.push({
                id: list[i],
                blobId: 'blob' + list[i],
                cc: [],
                bcc: [],
                htmlBody: null,
                textBody:
"On Mon, 14 Mar 2011 13:58:04 +0100, Ford Prefect wrote:\n\n>> the only special item you have to watch out for is the deduction for  \n>> being a foreigner. This deduction is relevant only during your first  \n>> two years in Norway, and it will save you some money.\n>\n> Is it only two years now? Then someone should update\n\n\"This page was last modified on 12 October 2005, at 11:26.\"\n\nYes, it's been 2 years ever since 2006, in that case, since when I started  \nit was :) 2 years ;) and has stayed the same since. :) ;)\n\nThere's an email address here:\n\nblah@blah.com\n\nAnd a url with space:\n\n<http://somewhere.com/a url\"with spaces.txt>\n\nA regular url here: http://somewhere.com\n\n> Some indented\n> text here\n",
                attachments: null,
                attachedInvites: null,
                attachedMessages: null
            });
        }
        results.push([ 'messages', {
            state: '123adf',
            list: result
        }]);
    },
    setMessages: function ( results, args ) {
        var create = Object.keys( args.create );
        results.push([ 'messagesSet', {
            created: Object.zip( create,
                ( function ( l, arr ) {
                    if ( l-- ) {
                        arr.push({
                            id: 'm' + Date.now() + '-' + l,
                            threadId: 't123',
                            isUnread: false,
                            isAnswered: false,
                            hasAttachment: false,
                            blobId: '1234'
                        });
                    }
                    return arr;
                }( create.length, [] ) ) ),
            updated: Object.keys( args.update ),
            destroyed: args.destroy
        }]);
    },
    getContactGroups: function ( results, args ) {
        results.push([ 'contactGroups', {
            list: [
                {
                    id: 'g1',
                    name: 'My Group',
                    contactIds: [ 'c1', 'c2' ]
                },
                {
                    id: 'g2',
                    name: 'My Other Group',
                    contactIds: [ 'c1', 'c3', 'c4' ]
                },
                {
                    id: 'g3',
                    name: 'The Last Group',
                    contactIds: [ 'c1' ]
                }
            ]
        }]);
    },
    setContactGroups: function ( results, args ) {
        results.push([ 'contactGroupsSet', {
            created: Object.zip( Object.keys( args.create ), Object.keys( args.create ) ),
            updated: Object.keys( args.update ),
            destroyed: args.destroy
        }]);
    },
    getContacts: function ( results, args ) {
        results.push([ 'contacts', {
            list: [
                {
                    id: 'c1',

                    isFlagged: false,

                    importance: 5,

                    title: '',
                    firstName: 'Neil',
                    lastName: 'Jenkins',

                    photo: '',
                    nickName: '',
                    birthday: '2010-11-01',

                    company: '',
                    department: '',
                    position: '',

                    emails: [
                        {
                            type: 'home',
                            value: 'neilhome@example.com',
                            isDefault: false
                        },
                        {
                            type: 'work',
                            value: 'neilwork@example.com',
                            isDefault: true
                        }
                    ],

                    addresses: [
                        {
                            id: 'ca1',
                            contactId: 'c1',
                            type: 'home',
                            description: 'home',

                            street: '19 ABC Way',
                            city: 'Melbourne',
                            state: 'VIC',
                            postcode: '3000',
                            country: 'Australia'
                        }
                    ],

                    notes: ''
                },
                {
                    id: 'c2',

                    isFlagged: true,

                    importance: 2,

                    title: '',
                    firstName: 'Sarah',
                    lastName: 'Hackett',

                    photo: '',
                    nickName: 'soupt',
                    birthday: '1987-02-17',

                    company: '',
                    department: '',
                    position: '',

                    emails: [
                        {
                            type: 'home',
                            value: 'sarah@example.com',
                            isDefault: true
                        }
                    ],

                    notes: ''
                },
                {
                    id: 'c3',

                    isFlagged: false,

                    importance: 5,

                    title: '',
                    firstName: 'Ford',
                    lastName: 'Prefect',

                    photo: '',
                    nickName: 'robo',
                    birthday: '2010-11-00',

                    company: '',
                    department: '',
                    position: '',

                    emails: [
                        {
                            type: 'work',
                            value: 'ford@example.com',
                            isDefault: true
                        }
                    ],

                    notes: ''
                },
                {
                    id: 'c4',

                    isFlagged: false,

                    importance: 1,

                    title: '',
                    firstName: 'Alfie',
                    lastName: 'Nohj',

                    photo: '',
                    nickName: '',
                    birthday: '2010-11-00',

                    company: '',
                    department: '',
                    position: '',

                    notes: ''
                }
            ],
            state: 'foo'
        }]);
    },
    setContacts: function ( results, args ) {
        results.push([ 'contactsSet', {
            created: Object.zip( Object.keys( args.create ), Object.keys( args.create ) ),
            updated: Object.keys( args.update ),
            destroyed: args.destroy
        }]);
    },
    getCalendars: function ( results, args ) {
        results.push([ 'calendars', {
            list: [{
                id: 'personal',
                name: 'Personal',
                colour: '#3a429c',
                isVisible: true
            },
            {
                id: 'choir',
                name: 'Choir',
                colour: '#ef5411',
                isVisible: true
            },
            {
                id: 'gym',
                name: 'Gym',
                colour: '#cc211b',
                isVisible: true
            },
            {
                id: 'work',
                name: 'Work',
                colour: '#0f6a0f',
                isVisible: true
            }]
        }]);
    },
    setCalendars: function ( results, args ) {
        results.push([ 'calendarsSet', {
            created: Object.zip( Object.keys( args.create ), Object.keys( args.create ) ),
            updated: Object.keys( args.update ),
            destroyed: Object.keys( args.destroy )
        }]);
    },
    getCalendarEventList: function ( results, args ) {
        if ( args.eventIds ) {
            results.push([ 'calendarEvents', {
                list: []
            }]);
        }
    },
    setCalendarEvents: function( results, args ) {
        results.push([ 'calendarEventsSet', {
            created: Object.zip( Object.keys( args.create ), Object.keys( args.create ) ),
            updated: Object.keys( args.update ),
            destroyed: Object.keys( args.destroy )
        }]);
    }
};
var XMLHttpRequest = function () {
    this.readyState = 0;
    this.status = 0;
    this.statusText = '';
    this.responseText = '';
    this.responseXML = null;
    this.onreadystatechange = function () {};
};
XMLHttpRequest.prototype.open = function ( method, url, async ) {
    if ( async === false ) {
        console.log( 'Massive fail: Synchronous XMLHttpRequest.' );
    }
    this._method = method;
    this._url = url;
};
XMLHttpRequest.prototype.setRequestHeader = function ( name, value ) {
    // console.log( 'Request header: ' + name + ' = ' + value );
};
// Random delay between 200 and 700 ms.
XMLHttpRequest.prototype.send = function ( data ) {
    if ( data !== null ) { console.log( data ); }
    if ( this._url === '/ajaxerror/' ) {
        console.log( data );
        return;
    }
    var that = this;
    this._request = setTimeout( function () {
        that._returnResultForData( data );
    }, ~~( Math.random() * 500 ) + 200 );
};
XMLHttpRequest.prototype.abort = function () {
    clearTimeout( this._request );
    XMLHttpRequest.call( this );
};
XMLHttpRequest.prototype.getResponseHeader = function ( name ) {
    if ( name === 'Content-type' ) {
        return 'application/json';
    }
};
XMLHttpRequest.prototype.getAllResponseHeaders = function () {
    return "IsLocal: True";
};
XMLHttpRequest.prototype._returnResultForData = function ( data ) {
    this.readyState = 4;
    if ( this._url.slice( 0, 8 ) === '/upload/' ) {
        this.status = 200;
        this.responseText = JSON.stringify( [[ 'upload', {
          path: "vfs:/user.fastmail.fm/temp/ae65bdd91230ae9bbc1.pdf",
          url: "https://fmusercontent.com/ae65bdd91230ae9bbc1/mydocument.pdf",
          type: "application/pdf",
          name: "mydocument.pdf",
          size: 8934,
          expires: "2014-10-11T14:34:41Z"
        }]] );
        this.onreadystatechange();
        return;
    }
    var methods = [];
    try {
        methods = JSON.parse( data ) || [];
    } catch ( error ) {}
    var result = [],
        k = 0, kk;
    for ( var i = 0, l = methods.length; i < l; i += 1 ) {
        var method = methods[i];
        API[ method[0] ] && API[ method[0] ]( result, method[1] );
        for ( kk = result.length; k < kk; k += 1 ) {
            result[k][2] = method[2];
        }
    }
    // Simulate 10% errors:
    // this.status = Math.random() > 0.9 ? 400 : 200;
    this.status = 200;
    this.responseText = JSON.stringify( result );
    // console.log( JSON.stringify( result, null, 2 ) );
    this.onreadystatechange();
};

window.XMLHttpRequest = XMLHttpRequest;

}() );
