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
                    order: 0,
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
                    order: 1,
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
                    order: 2,
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
                    order: 5,
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
                    order: 1,
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
                    order: 20,
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
                    order: 10,
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
                from: {name: 'Arthur Dent', email: 'arthur@example.com'},
                to: [ {name: 'Ford Prefect', email: 'ford@example.com'},
                    {name: 'Trillian McMillan', email: 'trills@example.com'} ],
                size: ~~( Math.random() * Math.random() * 100000 ),
                preview: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim adminim'
            }) :
            result.push({
                id: list[i],
                rawUrl: 'http://messages/' + list[i],
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
                            rawUrl: 'http://'
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

                    isShared: true,
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

                    isShared: true,
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

                    isShared: false,
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

                    isShared: false,
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
                list: [{
                    id: args.eventIds[0],

                    calendarId: 'personal',

                    summary: 'My awesome party',
                    description: "So, I'm like, totally having an awesome party. It's going to be the best thing since Kylie Minogue.",
                    location: "My house. In the middle of our street.",

                    isAllDay: false,
                    start: '2015-07-18T12:00:00',
                    end: '2015-07-18T13:00:00',

                    startTimeZone: null,
                    endTimeZone: null,

                    recurrence: null,
                    inclusions: null,
                    exceptions: null,

                    organiser: {
                        name: 'Joe Bloggs',
                        email: 'joe@booyah.com',
                        isYou: false
                    },
                    attendees: [
                      { name: 'Joe Bloggs', email: 'joe@booyah.com',
                        isYou: true, rsvp: 'yes' },
                      { name: 'Hermione Watson', email: 'herm@watto.com',
                        isYou: false, rsvp: 'maybe' }
                    ]
                }]
            }]);
            return;
        }
        results.push([ 'calendarEvents', {
            list: [{
                id: 'cal1',
                state: 'foo',

                calendarId: 'personal',

                summary: 'Party',
                description: 'The party of the century',
                location: 'Melbourne',
                showAsFree: false,

                isAllDay: false,
                start: '2015-07-18T12:00:00',
                end: '2015-07-18T13:00:00',
                startTimeZone: 'Europe/London',
                endTimeZone: 'Europe/London',
                recurrence: {
                    frequency: 'daily',
                    count: 3
                },
                inclusions: null,
                exceptions: null,

                alerts: [
                    {
                        minutesBefore: 60,
                        type: 'email'
                    },
                    {
                        minutesBefore: 15,
                        type: 'alert'
                    }
                ],

                attachments: [
                    {
                        name: 'file.doc',
                        size: 1421323,
                        url: '/d/test/download/file.doc'
                    },
                    {
                        name: 'file.xls',
                        size: 149150444123,
                        url: '/d/test/download/file.xls'
                    },
                    {
                        name: 'file.ppt',
                        size: 149150444123,
                        url: '/d/test/download/file.ppt'
                    },
                    {
                        name: 'Flower.jpg',
                        size: 1633,
                        url: 'http://farm7.staticflickr.com/6146/5994894196_5b989248e2_b.jpg'
                    },
                    {
                        name: 'Train.jpg',
                        size: 1633,
                        url: 'http://farm7.staticflickr.com/6005/5994325683_1441d5ba7d_b.jpg'
                    },
                ]
            },
            {
                id: 'cal2',
                state: 'foo',

                calendarId: 'personal',

                summary: 'After the party of the century',
                description: 'After the party of the century',
                location: 'Sydney',
                showAsFree: false,

                isAllDay: false,
                start: '2013-11-04T18:00:00',
                end: '2013-11-04T18:00:00',
                startTimeZone: 'Etc/UTC',
                endTimeZone: 'Etc/UTC',
                recurrence: null,
                inclusions: null,
                exceptions: null,

                alerts: null
            },
            {
                id: 'cal3',
                state: 'foo',

                calendarId: 'work',

                summary: 'This is a long all day event',
                description: '',
                location: 'Sydney',
                showAsFree: false,

                isAllDay: true,
                start: '2013-11-03T00:00:00',
                end: '2013-11-07T00:00:00',
                startTimeZone: null,
                endTimeZone: null,
                recurrence: null,
                inclusions: null,
                exceptions: null,

                alerts: null
            },
            {
                id: 'cal4',
                state: 'foo',

                calendarId: 'choir',

                summary: 'Do they stack 1?',
                description: '',
                location: 'Sydney',
                showAsFree: false,

                isAllDay: true,
                start: '2013-11-04T00:00:00',
                end: '2013-11-06T00:00:00',
                startTimeZone: null,
                endTimeZone: null,
                recurrence: null,
                inclusions: null,
                exceptions: null,

                alerts: null
            },
            {
                id: 'cal5',
                state: 'foo',

                calendarId: 'gym',

                summary: 'Do they stack 2?',
                description: '',
                location: 'Sydney',
                showAsFree: false,

                isAllDay: true,
                start: '2013-11-05T00:00:00',
                end: '2013-11-07T00:00:00',
                startTimeZone: null,
                endTimeZone: null,
                recurrence: null,
                inclusions: null,
                exceptions: null,

                alerts: [
                    {
                        minutesBefore: 0,
                        type: 'email'
                    }
                ]
            },
            {
                id: 'cal6',
                state: 'foo',

                calendarId: 'personal',

                summary: 'Sundays in Jan',
                description: '',
                location: 'Sydney',
                showAsFree: false,

                isAllDay: false,
                start: '2015-01-04T08:00:00',
                end: '2015-01-04T08:30:00',
                startTimeZone: null,
                endTimeZone: null,
                recurrence: {frequency:'yearly', interval:2,byMonth:[0],byDay:[0],byHour:[8,9],byMinute:[30]},
                inclusions: null,
                exceptions: null,

                alerts: null
            },
            {
                id: 'cal7',
                state: 'foo',

                calendarId: 'personal',

                summary: 'Last weekday of month',
                description: 'After the party of the century',
                location: 'Sydney',
                showAsFree: false,

                isAllDay: false,
                start: '2014-10-31T14:43:00',
                end: '2014-10-31T15:00:00',
                startTimeZone: null,
                endTimeZone: null,
                recurrence: {
                    frequency: 'monthly',
                    byDay: [ 1, 2, 3, 4, 5 ],
                    bySetPosition: [ -1 ],
                    count: 12
                },
                inclusions: null,
                exceptions: {
                    '2013-11-29T13:43:00': null
                },

                alerts: null
            },
            {
                id: 'cal8',
                state: 'foo',

                calendarId: 'personal',

                summary: 'Repeat five setTimeouts',
                description: 'But skip the middle 3',
                location: '',
                showAsFree: false,

                isAllDay: true,
                start: '2013-10-21T00:00:00',
                end: '2013-10-22T00:00:00',
                startTimeZone: null,
                endTimeZone: null,
                recurrence: {
                    frequency: 'daily',
                    count: 5
                },
                inclusions: null,
                exceptions: {
                    '2013-10-22T00:00:00': null,
                    '2013-10-23T00:00:00': {
                        summary: 'The middle one (exceptional)'
                    },
                    '2013-10-24T00:00:00': null
                },

                alerts: null
            },
            {
                id: 'cal9',

                calendarId: 'personal',

                summary: 'Inclusions test',
                description: '',
                location: '',
                showAsFree: false,

                isAllDay: false,
                start: '2014-05-05T03:00:00',
                end: '2014-05-05T04:00:00',
                startTimeZone: 'Australia/Melbourne',
                endTimeZone: 'Australia/Melbourne',
                recurrence: {
                    frequency: 'daily',
                    interval: 4,
                    count: 5
                },
                inclusions: [
                    '2014-05-08T14:00:00',
                    '2014-05-09T14:00:00',
                    '2014-05-10T14:00:00'
                ],
                exceptions: null,

                organiser: {
                    name: 'Neil Jenkins',
                    email: 'neilj@fastmail.fm',
                    isYou: false
                },
                attendees: [
                    {
                        name: 'Neil Jenkins',
                        email: 'neilj@fastmail.fm',
                        rsvp: 'yes',
                        isYou: false
                    },
                    {
                        name: 'Joe Bloggs',
                        email: 'joe@bloggs.com',
                        rsvp: 'no',
                        isYou: true
                    },
                    {
                        name: 'John Smith',
                        email: 'hohoho@smial.com',
                        rsvp: 'no',
                        isYou: false
                    }
                ],

                alerts: null
            },
            {
                id: 'r1',
                calendarId: 'personal',
                summary: 'An example where an invalid date (i.e., February 30) is ignored.',
                description: '(2007 EST) January 15,30 (2007 EST) February 15 (2007 EDT) March 15,30',
                location: '',
                showAsFree: false,
                isAllDay: false,
                start: '1997-01-15T09:00:00',
                end: '1997-01-15T10:00:00',
                startTimeZone: 'America/New_York',
                endTimeZone: 'America/New_York',
                recurrence: {
                    frequency: 'monthly',
                    byDate: [ 15, 30 ],
                    count: 5
                },
                inclusions: null,
                exceptions: null,
                alerts: null
            },
            //DTSTART;TZID=America/New_York:19970805T090000
            //RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=MO
            {
                id: 'r2',
                calendarId: 'personal',
                summary: 'WKST=MO',
                description: '(1997 EDT) August 5,10,19,24',
                location: '',
                showAsFree: false,
                isAllDay: false,
                start: '1997-08-05T09:00:00',
                end: '1997-08-05T10:00:00',
                startTimeZone: null,
                endTimeZone: null,
                recurrence: {
                    frequency: 'weekly',
                    interval: 2,
                    byDay: [ 0, 2 ],
                    count: 4
                },
                inclusions: null,
                exceptions: null,
                alerts: null
            },
            //DTSTART;TZID=America/New_York:19970805T090000
            //RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=MO
            {
                id: 'r3',
                calendarId: 'personal',
                summary: 'WKST=SU',
                description: '(1997 EDT) August 5,17,19,31',
                location: '',
                showAsFree: false,
                isAllDay: false,
                start: '1997-08-05T09:00:00',
                end: '1997-08-05T10:00:00',
                startTimeZone: null,
                endTimeZone: null,
                recurrence: {
                    firstDayOfWeek: 0,
                    frequency: 'weekly',
                    interval: 2,
                    byDay: [ 0, 2 ],
                    count: 4
                },
                inclusions: null,
                exceptions: null,
                alerts: null
            },
            //DTSTART;TZID=America/New_York:19961105T090000
            //RRULE:FREQ=YEARLY;INTERVAL=4;BYMONTH=11;BYDAY=TU;BYMONTHDAY=2,3,4,5,6,7,8
            {
                id: 'r4',
                calendarId: 'personal',
                summary: 'President',
                description: '',
                location: '',
                showAsFree: false,
                isAllDay: false,
                start: '1996-11-05T09:00:00',
                end: '1996-11-05T10:00:00',
                startTimeZone: null,
                endTimeZone: null,
                recurrence: {
                    firstDayOfWeek: 0,
                    frequency: 'yearly',
                    interval: 4,
                    byMonth: [ 10 ],
                    byDay: [ 2 ],
                    byDate: [ 2, 3, 4, 5, 6, 7, 8 ]
                },
                inclusions: null,
                exceptions: null,
                alerts: null
            },
            //DTSTART;TZID=America/New_York:19970913T090000
            //RRULE:FREQ=MONTHLY;BYDAY=SA;BYMONTHDAY=7,8,9,10,11,12,13
            {
                id: 'r5',
                calendarId: 'personal',
                summary: 'First Sat after Sun',
                description: '',
                location: '',
                showAsFree: false,
                isAllDay: false,
                start: '1997-09-13T09:00:00',
                end: '1997-09-13T10:00:00',
                startTimeZone: null,
                endTimeZone: null,
                recurrence: {
                    frequency: 'monthly',
                    byDay: [ 6 ],
                    byDate: [ 7, 8, 9, 10, 11, 12, 13 ]
                },
                inclusions: null,
                exceptions: null,
                alerts: null
            },
            {
                id: 'r6',
                calendarId: 'personal',
                summary: 'TZ shift',
                description: '',
                location: '',
                showAsFree: false,
                isAllDay: false,
                start: '2007-03-09T07:30:00',
                end: '2007-03-09T07:45:00',
                startTimeZone: 'America/New_York',
                endTimeZone: 'America/New_York',
                recurrence: {
                    frequency: 'daily',
                    count: 5
                },
                inclusions: null,
                exceptions: null,
                alerts: null
            },
            {
                id: 'r7',
                calendarId: 'personal',
                summary: 'TZ shift',
                description: '',
                location: '',
                showAsFree: false,
                isAllDay: false,
                start: '2015-04-03T15:30:00',
                end: '2015-04-03T16:30:00',
                startTimeZone: 'Australia/Melbourne',
                endTimeZone: 'Australia/Melbourne',
                recurrence: {
                    frequency: 'daily',
                    count: 5
                },
                inclusions: null,
                exceptions: null,
                alerts: null
            }
            ]
        }]);
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
