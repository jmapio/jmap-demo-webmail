/*global console, setTimeout, clearTimeout, window */
"use strict";

( function () {

// Feel free to twiddle these for your own testing.
var XHR_LOGGING = {
    requests: true,
    responses: false,
    stringifyJSON: true,
};

var confirmCommit = function ( args ) {
    var result = {};
    if ( args.create ) {
        result.created = Object.zip(
            Object.keys( args.create ),
            Object.keys( args.create ).map( function ( id ) {
                return { id: id };
            })
        );
    }
    if ( args.update )  {
        result.updated = Object.zip(
            Object.keys( args.update ),
            Object.keys( args.update ).map( function () {
                return null;
            })
        );
    }
    if ( args.destroy ) {
        result.destroyed = args.destroy;
    }
    return result;
};

var API = {
        'Mailbox/get': function ( results, args ) {
        results.push(['Mailbox/get', {
            state: 'asdf',
            list: [
                {
                    id: 'm1',
                    name: 'Inbox',
                    role: 'inbox',
                    parentId: null,
                    sortOrder: 0,
                    isCollapsed: true,
                    hidden: 0,
                    totalEmails: 23,
                    unreadEmails: 8,
                    totalThreads: 23,
                    unreadThreads: 8
                },
                {
                    id: 'm2',
                    name: 'Drafts',
                    role: 'drafts',
                    sortOrder: 2,
                    parentId: null,
                    isCollapsed: true,
                    hidden: 0,
                    totalEmails: 142,
                    unreadEmails: 0,
                    totalThreads: 142,
                    unreadThreads: 0
                },
                {
                    id: 'm3',
                    name: 'Sent',
                    role: 'sent',
                    sortOrder: 5,
                    parentId: null,
                    isCollapsed: true,
                    hidden: 0,
                    totalEmails: 144,
                    unreadEmails: 5,
                    totalThreads: 144,
                    unreadThreads: 5
                },
                {
                    id: 'm4',
                    name: 'Archive',
                    role: 'archive',
                    sortOrder: 1,
                    parentId: null,
                    isCollapsed: true,
                    hidden: 0,
                    identityId: '5',
                    totalEmails: 24,
                    unreadEmails: 0,
                    totalThreads: 24,
                    unreadThreads: 0
                },
                {
                    id: 'm5',
                    name: 'Trash',
                    role: 'trash',
                    sortOrder: 20,
                    parentId: null,
                    isCollapsed: true,
                    hidden: 0,
                    identityId: '20',
                    totalEmails: 2,
                    unreadEmails: 0,
                    totalThreads: 2,
                    unreadThreads: 0
                },
                {
                    id: 'm6',
                    name: 'Spam',
                    role: 'junk',
                    sortOrder: 10,
                    parentId: null,
                    isCollapsed: true,
                    hidden: 0,
                    identityId: '100',
                    totalEmails: 1,
                    unreadEmails: 4,
                    totalThreads: 1,
                    unreadThreads: 4
                },
            ],
            notFound: null
        }]);
    },
    'Mailbox/set': function ( results, args ) {
        results.push(['Mailbox/set', confirmCommit( args ) ]);
    },
    'Email/query': function ( results, args ) {
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
        results.push(['Email/query', {
            filter: args.filter,
            sort: args.sort,
            collapseThreads: args.collapseThreads,
            state: 'u123v42',
            canCalculateChanges: true,
            position: start,
            total: 1000,
            ids: result,
        }]);
    },
    'Email/queryChanges': function () {},
    'SearchSnippet/get': function ( results, args ) {
        var snippets = args.emailIds.map( function ( id ) {
            return {
                emailId: id,
                subject: Math.random() > 0.8 ?
                    'This is a <mark>search</mark> subject' : '',
                preview: Math.random() > 0.5 ?
                    'This is a <mark>search</mark> snippet, but <b>there</b> may be other results' : ''
            };
        });
        results.push(['SearchSnippet/get', {
            filter: args.filter,
            list: snippets,
            notFound: null,
        }]);
    },
    'Thread/get': function ( results, args ) {
        results.push(['Thread/get', {
            state: 'u123v42',
            list: args.ids.map( function ( id ) {
                return {
                    id: id,
                    emailIds: [ id, id + '-2', id + '-3' ]
                };
            }),
            notFound: null
        }]);
    },
    'Email/get': function ( results, args ) {
        var list = args.ids,
            result = [];
        for ( var i = 0, l = list.length; i < l; i += 1 ) {
            args.properties[0] === 'threadId' ? result.push({
                id: list[i],
                threadId: list[i].replace( /\-\d$/, '' ),
                mailboxIds: { 'm1': true },
                keywords: {
                    $seen: Math.random() > 0.3,
                    $answered: Math.random() > 0.8,
                },
                hasAttachment: Math.random() > 0.8,
                receivedAt: new Date(
                    Date.now() - ~~( Math.random() * 10000000000 ) ).toJSON(),
                subject: 'ById: Opera Mail: slick, stylish, sophisticated',
                from: [{name: 'ACME Staff', email: 'nmjenkins@facebook.com'}],
                to: [ {name: 'A.N. Other', email: 'jimmy@jimjim.ja'},
                    {name: 'Imogen Jones', email: 'immy@jones.com'} ],
                size: ~~( Math.random() * Math.random() * 100000 ),
                preview: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim adminim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.'
            }) :
            result.push({
                id: list[i],
                blobId: 'http://messages/' + list[i],
                cc: [],
                bcc: [],
                replyTo: [ {name:'Neil Jenkins', email: 'neil@replyto.com'} ],
                sentAt: new Date(
                    Date.now() - ~~( Math.random() * 10000000000 ) ).toJSON(),
                'header:x-a-long-header:all': [ 'Value' ],
            'header:x-spam-score:all': [ 'And Again' ],
                isSuspicious: true,
                hasBlockedContent: false,
                bodyValues: {
                    html: args.fetchAllBodyValues || args.fetchHTMLBodyValues ? { isTruncated: !args.fetchAllBodyValues, value: "<div>asdfasdf<br></div><div>a<br></div><div>sdfasdf<br></div><div><br></div><div>asdf<br></div><div>asdf<br></div><div><br></div><div>asdf</div><div><br></div><div>On Fri, 20 Jan 2012, at 06:14 AM, Marian Hackett wrote:<br></div><blockquote><div><br></div><div><a href=\"https://bugs.opera.com/browse/IRIS-1199 target=\" defang__top\"=\"\" target=\"_blank\">https://bugs.opera.com/browse/IRIS-1199</a target=\"_blank\"><br></div><div><br></div><div><br></div><div>Marian Hackett updated IRIS-1199:<br></div><div>---------------------------------<br></div><div><br></div><div> &nbsp; Priority: P3&nbsp; (was: \u2014)<br></div><div> &nbsp; &nbsp; &nbsp; &nbsp; CC: [johan, marianh, neilj, rjlov, robm]<br></div><div><br></div><div><br></div><div><br></div><div>-- <br></div><div>This message is automatically generated by JIRA.<br></div><div><br></div><div><br></div><div><br></div></blockquote>\n",
                    } : null,
                    text: args.fetchAllBodyValues || args.fetchTextBodyValues ? { value:
"On Mon, 14 Mar 2011 13:58:04 +0100, Peter Krefting <peter@opera.com> wrote:\n\n> Conrad Newton <conrad.newton@opera.com>:\n>\n>> the only special item you have to watch out for is the deduction for  \n>> being a foreigner. This deduction is relevant only during your first  \n>> two years in Norway, and it will save you some money.\n>\n> Is it only two years now? Then someone should update  \n> https://wiki.oslo.osa/staffwiki/ExPats/Tax\n>\n\n\"This page was last modified on 12 October 2005, at 11:26.\"\n\nYes, it's been 2 years ever since 2006, in that case, since when I started  \nit was :) 2 years ;) and has stayed the same since. :) ;)\n\nThere's an email address here:\n\nblah@blah.com\n\nAnd a url with space:\n\n<http://somewhere.com/a url\"with spaces.txt>\n\nA regular url here: http://somewhere.com\n\n> Some indented\n> text here\n\nAnd *this* should be bold and _this_ should be underlined\n\nThis is an FTP link: ftp://foo.example.com.\n\nWhat about _this_and_this_ which should all be underlined, and *all*of*this* should be bold\n\n\n-- \nDevil May Care\n_______________________________________________\nEx-pats mailing list\nEx-pats@list.opera.com\nhttps://list.opera.com/mailman/listinfo/ex-pats\n\n"
                    } : null,
                },
                bodyStructure: {
                    type: 'multipart/mixed',
                    subParts: [
                {
                    type: 'multipart/alternative',
                    subParts: [
                        {
                            partId: 'html',
                            type: 'text/html',
                            size: 1301302
                        },
                        {
                            partId: 'text',
                            type: 'text/plain',
                            size: 1301302
                        }
                    ],
                },
                {
                    name: 'file.doc',
                    type: 'application/doc',
                    size: 1421323,
                    blobId: 'atDOC',
                    disposition: 'attachment',
                },
                {
                    name: 'file.xls',
                    type: 'application/xls',
                    size: 149150444123,
                    blobId: 'atXLS',
                },
                {
                    name: 'file.ppt',
                    type: 'application/ppt',
                    size: 149150444123,
                    blobId: 'atPPT',
                    isDeleted: true,
                    disposition: 'attachment',
                },
                {
                    name: 'invitation.ical',
                    type: 'text/calendar',
                    size: 149150444123,
                    blobId: 'ical',
                    disposition: 'attachment',
                },
                {
                    name: 'message.eml',
                    type: 'message/rfc822',
                    size: 104,
                    blobId: 'msg1',
                    disposition: 'attachment',
                },
                {
                    name: 'Flower.jpg',
                    type: 'image/jpeg',
                    size: 1633,
                    width: 683,
                    height: 1024,
                    blobId: 'http://farm7.staticflickr.com/6146/5994894196_5b989248e2_b.jpg',
                    disposition: 'attachment'
                },
                {
                    name: 'Train.jpg',
                    type: 'image/jpeg',
                    size: 1633,
                    width: 683,
                    height: 1024,
                    blobId: 'http://farm7.staticflickr.com/6005/5994325683_1441d5ba7d_b.jpg',
                    disposition: 'attachment',
                },
                {
                    name: 'cat.jpg',
                    type: 'image/jpeg',
                    size: 1633,
                    width: 1024,
                    height: 1024,
                    blobId: 'http://farm7.staticflickr.com/6005/5994341117_ba1d3218c9_b.jpg',
                    disposition: 'attachment'
                },
                {
                    name: 'sushi.jpg',
                    type: 'image/jpeg',
                    size: 1633,
                    width: 1024,
                    height: 683,
                    blobId: 'http://farm7.staticflickr.com/6132/5994905208_31c966fe70_b.jpg',
                    disposition: 'attachment',
                }
                ]},
                calendarEvents: {
                    ical: [{
                        method: 'request',
                        title: 'My awesome party',
                        description: "So, I'm like, totally having an awesome party. It's going to be the best thing since Kylie Minogue.",
                        locations: {
                            'foo': {
                                name: 'The Park\n99 Cedar Ave\nWindsor'
                            },
                        },

                        isAllDay: false,
                        start: '2015-01-04T08:00:00',
                        duration: 'PT2H0M0S',
                        timeZone: 'Europe/London',

                        recurrenceRule: {frequency:'weekly', count: 10},
                        replyTo: {
                            imip:'mailto:uuid@calendar.bot.fastmail.com',
                        },
                        participants: {
                            'neilj@fastmail.fm': {
                                name: 'Neil Jenkins',
                                email: 'neilj@fastmail.fm',
                                rsvpResponse: 'accepted',
                                roles: { owner: true, chair: true, attendee: true },
                            },
                            'joe@bloggs.com': {
                                name: 'Joe Bloggs',
                                email: 'joe@bloggs.com',
                                rsvpResponse: 'accepted',
                                roles: { attendee: true },
                            },
                            'hohoho@smial.com': {
                                name: 'John Smith',
                                email: 'hohoho@smial.com',
                                rsvpResponse: 'declined',
                                roles: { attendee: true },
                            },
                        },
                        links: {
                            file: {
                                title: 'file.doc',
                                size: 1421323,
                                href: '/d/test/download/file.doc',
                                rel: 'enclosure',
                            },
                            file2: {
                                title: 'file.xls',
                                size: 149150444123,
                                href: '/d/test/download/file.xls',
                                rel: 'enclosure',
                            },
                            file3: {
                                title: 'file.ppt',
                                size: 149150444123,
                                href: '/d/test/download/file.ppt',
                                rel: 'enclosure',
                            },
                            Flower: {
                                title: 'Flower.jpg',
                                size: 1633,
                                href: 'http://farm7.staticflickr.com/6146/5994894196_5b989248e2_b.jpg',
                                rel: 'enclosure',
                            },
                            Train: {
                                title: 'Train.jpg',
                                size: 1633,
                                href: 'http://farm7.staticflickr.com/6005/5994325683_1441d5ba7d_b.jpg',
                                rel: 'enclosure',
                            },
                        },
                    }]
                },
                attachedEmails: {
                msg1: {
                  id: 'foobar',
                  from: [{
                      name: 'Neil Jenkins',
                      email: 'neil@nmjenkins.com'
                  }],
                  to: [{
                      name: 'Neil Jenkins',
                      email: 'neil@nmjenkins.com'
                  }, {
                      name: 'Rob Mueller',
                      email: 'robm@fastmail.fm'
                  }],
                  cc: [{
                      name: 'Neil Jenkins',
                      email: 'neil@nmjenkins.com'
                  }],
                  subject: 'This is an email',
                  date: 19473917413,
                  hasBlockedContent: false,
                  textBody: false ? "<div>asdfasdf<br></div><div>a<br></div><div>sdfasdf<br></div><div><br></div><div>asdf<br></div><div>asdf<br></div><div><br></div><div>asdf</div><div><br></div><div>On Fri, 20 Jan 2012, at 06:14 AM, Marian Hackett wrote:<br></div><blockquote><div><br></div><div><a href=\"https://bugs.opera.com/browse/IRIS-1199 target=\" defang__top\"=\"\" target=\"_blank\">https://bugs.opera.com/browse/IRIS-1199</a target=\"_blank\"><br></div><div><br></div><div><br></div><div>Marian Hackett updated IRIS-1199:<br></div><div>---------------------------------<br></div><div><br></div><div> &nbsp; Priority: P3&nbsp; (was: \u2014)<br></div><div> &nbsp; &nbsp; &nbsp; &nbsp; CC: [johan, marianh, neilj, rjlov, robm]<br></div><div><br></div><div><br></div><div><br></div><div>-- <br></div><div>This message is automatically generated by JIRA.<br></div><div><br></div><div><br></div><div><br></div></blockquote>\n" :
  "On Mon, 14 Mar 2011 13:58:04 +0100, Peter Krefting <peter@opera.com> wrote:\n\n> Conrad Newton <conrad.newton@opera.com>:\n>\n>> the only special item you have to watch out for is the deduction for  \n>> being a foreigner. This deduction is relevant only during your first  \n>> two years in Norway, and it will save you some money.\n>\n> Is it only two years now? Then someone should update  \n> https://wiki.oslo.osa/staffwiki/ExPats/Tax\n>\n\n\"This page was last modified on 12 October 2005, at 11:26.\"\n\nYes, it's been 2 years ever since 2006, in that case, since when I started  \nit was 2 years and has stayed the same since.\n\nThere's an email address here:\n\nblah@blah.com\n\nAnd a url with space:\n\n<http://somewhere.com/a url\"with spaces.txt>\n\nA regular url here: http://somewhere.com\n\n> Some indented\n> text here\n\nAnd *this* should be bold and _this_ should be underlined\n\nWhat about _this_and_this_ which should all be underlined, and *all*of*this* should be bold\n\n\n-- \nDevil May Care\n_______________________________________________\nEx-pats mailing list\nEx-pats@list.opera.com\nhttps://list.opera.com/mailman/listinfo/ex-pats\n\n",
                  attachments: [
                  {
                      name: 'file.doc',
                      size: 1421323,
                      id: 'atDOC'
                  },
                  {
                      name: 'file.xls',
                      size: 149150444123,
                      id: 'atXLS'
                  },
                  {
                      name: 'file.ppt',
                      size: 149150444123,
                      id: 'atPPT'
                  },
                  {
                      name: 'message.eml',
                      size: 104,
                      id: 'msg1'
                  },
                  {
                      name: 'Flower.jpg',
                      size: 1633,
                      id: 'attachment1',
                      width: 683,
                      height: 1024,
                      blobId: 'http://farm7.staticflickr.com/6146/5994894196_5b989248e2_b.jpg',
                  },
                  {
                      name: 'Train.jpg',
                      size: 1633,
                      id: 'attachment2',
                      width: 683,
                      height: 1024,
                      blobId: 'http://farm7.staticflickr.com/6005/5994325683_1441d5ba7d_b.jpg'
                  },
                  {
                      name: 'cat.jpg',
                      size: 1633,
                      id: 'attachment3',
                      width: 1024,
                      height: 1024,
                      blobId: 'http://farm7.staticflickr.com/6005/5994341117_ba1d3218c9_b.jpg'
                  },
                  {
                      name: 'sushi.jpg',
                      size: 1633,
                      id: 'attachment4',
                      width: 1024,
                      height: 683,
                      blobId: 'http://farm7.staticflickr.com/6132/5994905208_31c966fe70_b.jpg'
                  }
                  ],
                  attachedEmails: {
                  msg1: {
                    id: 'foobar',
                    from: [{
                        name: 'Neil Jenkins',
                        email: 'neil@nmjenkins.com'
                    }],
                    to: [{
                        name: 'Neil Jenkins',
                        email: 'neil@nmjenkins.com'
                    }, {
                        name: 'Rob Mueller',
                        email: 'robm@fastmail.fm'
                    }],
                    cc: [{
                        name: 'Neil Jenkins',
                        email: 'neil@nmjenkins.com'
                    }],
                    extraHeaders: [
                        [ 'X-Header', 'Value' ],
                        [ 'X-Another', 'And Again' ]
                    ],
                    subject: 'This is an email',
                    date: 19473917413,
                    hasBlockedContent: true,
                    htmlBody:"<div>asdfasdf<br></div><div>a<br></div><div>sdfasdf<br></div><div><br></div><div>asdf<br></div><div>asdf<br></div><div><br></div><div>asdf</div><div><br></div><div>On Fri, 20 Jan 2012, at 06:14 AM, Marian Hackett wrote:<br></div><blockquote><div><br></div><div><a href=\"mailto:neilj@fastmail.fm\">mailto link</a> <a href=\"https://bugs.opera.com/browse/IRIS-1199 target=\" defang__top\"=\"\" target=\"_blank\">https://bugs.opera.com/browse/IRIS-1199</a target=\"_blank\"><br></div><div><br></div><div><br></div><div>Marian Hackett updated IRIS-1199:<br></div><div>---------------------------------<br></div><div><br></div><div> &nbsp; Priority: P3&nbsp; (was: \u2014)<br></div><div> &nbsp; &nbsp; &nbsp; &nbsp; CC: [johan, marianh, neilj, rjlov, robm]<br></div><div><br></div><div><br></div><div><br></div><div>-- <br></div><div>This message is automatically generated by JIRA.<br></div><div><br></div><div><br></div><div><br></div></blockquote>\n" ,
                    attachments: [
                    {
                        name: 'file.doc',
                        size: 1421323,
                        id: 'atDOC'
                    },
                    {
                        name: 'file.xls',
                        size: 149150444123,
                        id: 'atXLS'
                    },
                    {
                        name: 'file.ppt',
                        size: 149150444123,
                        id: 'atPPT'
                    }],
                    attachedEmails: {}
                  }
                }
                }
              }
            });
        }
        results.push([ 'Email/get', {
            state: '123adf',
            list: result
        }]);
    },
    'Email/set': function ( results, args ) {
        var x = confirmCommit( args );
        var created = args.created;
        for ( var id in created ) {
            Object.assign( created[ id ], {
                blobId: 'http://',
                threadId: 't123',
            });
        }
        results.push([ 'Email/set', x ]);
    },
    'EmailSubmission/get': function ( results, args ) {
        results.push(['EmailSubmission/get', {
            state: '1234',
            list: [],
        }]);
    },
    'EmailSubmission/set': function ( results, args ) {
        results.push(['EmailSubmission/set', confirmCommit( args ) ]);
    },
    'Identity/get': function ( results, args ) {
        results.push( [ 'Identity/get', {
            list: [{
                id: '3',
                email: 'joe@bloggs.com',
                name: 'Joe Bloggs',
                textSignature: 'Joe Bloggs :: <joe@bloggs.com>',
                htmlSignature: 'Joe Bloggs :: <a href="mailto:joe@bloggs.com">joe@bloggs.com</a>',
            }]
        }]);
    },
    'VacationResponse/get': function ( results, args ) {
        results.push([ 'VacationResponse/get', {
            list: [{
                id: 'singleton',
                isEnabled: true,
                textBody: '',
            }],
        }]);
    },
    'ContactGroup/get': function ( results, args ) {
        results.push([ 'ContactGroup/get', {
            state: 'foo',
            list: []
        }]);
    },
    'ContactGroup/set': function ( results, args ) {
        results.push([ 'ContactGroup/set', confirmCommit( args ) ]);
    },
    'Contact/get': function ( results, args ) {
        results.push([ 'Contact/get', {
            list: [],
            state: 'foo'
        }]);
    },
    'Contact/set': function ( results, args ) {
        results.push([ 'Contact/set', confirmCommit( args ) ]);
    },
    'Calendar/get': function ( results, args ) {
        results.push([ 'Calendar/get', {
            state: 'foo',
            list: [{
                id: 'personal',
                name: 'Personal',
                isVisible: true,
                sortOrder: 0,
                color: '#3a429c',
                mayReadItems: true,
                mayAddItems: true,
                mayModifyItems: true,
                mayRemoveItems: true,
                mayAdmin: true
            },
            {
                id: 'choir',
                name: 'Choir',
                isVisible: true,
                sortOrder: 96,
                sharedBy: '1',
                color: '#ef5411',
                mayReadItems: true,
                mayAddItems: true,
                mayModifyItems: true,
                mayRemoveItems: true,
                mayAdmin: false
            },
            {
                id: 'gym',
                name: 'Gym',
                isVisible: true,
                sortOrder: 64,
                color: '#cc211b',
                mayReadItems: true,
                mayAddItems: false,
                mayModifyItems: false,
                mayRemoveItems: false,
                mayAdmin: true
            },
            {
                id: 'work',
                name: 'Work',
                isVisible: true,
                sortOrder: 32,
                color: '#0f6a0f',
                mayReadItems: true,
                mayAddItems: true,
                mayModifyItems: true,
                mayRemoveItems: true,
                mayAdmin: true
            }]
        }]);
    },
    'Calendar/set': function ( results, args ) {
        results.push([ 'Calendar/set', confirmCommit( args ) ]);
    },
    'CalendarEvent/query': function ( results, args ) {
        if ( args.eventIds ) {
            results.push([ 'CalendarEvent/get', {
                list: [{
                    id: args.eventIds[0],

                    calendarId: 'personal',

                    title: 'My awesome party',
                    description: "So, I'm like, totally having an awesome party. It's going to be the best thing since Kylie Minogue.",

                    isAllDay: false,
                    start: '2016-07-01T12:00:00',
                    duration: 'PT3H0M0S',

                    timeZone: null,

                    recurrenceRule: null,
                    recurrenceOverrides: null,

                    participants: null
                }]
            }]);
            return;
        }
        results.push([ 'CalendarEvent/get', {
            list: [{
                id: 'cal1',

                calendarId: 'personal',

                title: 'Party',
                description: 'The party of the century',
                freeBusyStatus: 'busy',

                isAllDay: false,
                start: '2018-03-14T11:30:00',
                duration: 'PT2H0M0S',
                timeZone: 'Europe/London',

                recurrenceRule: {
                    frequency: 'daily',
                    count: 3
                },

                links: {
                    file: {
                        title: 'file.doc',
                        size: 1421323,
                        href: '/d/test/download/file.doc',
                        rel: 'enclosure',
                    },
                    file2: {
                        title: 'file.xls',
                        size: 149150444123,
                        href: '/d/test/download/file.xls',
                        rel: 'enclosure',
                    },
                    file3: {
                        title: 'file.ppt',
                        size: 149150444123,
                        href: '/d/test/download/file.ppt',
                        rel: 'enclosure',
                    },
                    Flower: {
                        title: 'Flower.jpg',
                        size: 1633,
                        href: 'http://farm7.staticflickr.com/6146/5994894196_5b989248e2_b.jpg',
                        rel: 'enclosure',
                    },
                    Train: {
                        title: 'Train.jpg',
                        size: 1633,
                        href: 'http://farm7.staticflickr.com/6005/5994325683_1441d5ba7d_b.jpg',
                        rel: 'enclosure',
                    },
                },
            },
            {
                id: 'cal2',

                calendarId: 'personal',

                title: 'After the party of the century',
                description: 'After the party of the century',
                freeBusyStatus: 'busy',

                isAllDay: false,
                start: '2017-03-14T18:00:00',
                duration: 'PT2H30M0S',
                timeZone: 'Europe/London',

                recurrenceRule: null,

                alerts: null
            },
            {
                id: 'cal3',
                state: 'foo',

                calendarId: 'work',

                title: 'This is a long all day event',
                description: '',
                location: 'Sydney',
                freeBusyStatus: 'busy',

                isAllDay: true,
                start: '2018-03-03T00:00:00',
                duration: 'P6D',
                timeZone: null,
                recurrenceRule: null,
                recurrenceOverrides: null,

                alerts: null
            },
            {
                id: 'cal4',
                state: 'foo',

                calendarId: 'choir',

                title: 'Do they stack 1?',
                description: '',
                location: 'Sydney',
                freeBusyStatus: 'busy',

                isAllDay: true,
                start: '2018-03-04T00:00:00',
                duration: 'P1D',
                timeZone: null,
                recurrenceRule: null,
                recurrenceOverrides: null,

                alerts: null
            },
            {
                id: 'cal5',
                state: 'foo',

                calendarId: 'gym',

                title: 'Do they stack 2?',
                description: '',
                location: 'Sydney',
                freeBusyStatus: 'busy',

                isAllDay: true,
                start: '2018-03-05T00:00:00',
                duration: 'P2D',
                timeZone: null,
                recurrenceRule: null,
                recurrenceOverrides: null,

                alerts: {
                    'foo': {
                        relativeTo: 'before-start',
                        offste: 0,
                        action: {
                            type: 'email',
                            to: [{ email: 'neilj@fastmail.fm' }],
                        }
                    }
                }
            },
            {
                id: 'cal6',
                state: 'foo',

                calendarId: 'personal',

                title: 'Sundays in Jan',
                description: '',
                location: 'Sydney',
                freeBusyStatus: 'busy',

                isAllDay: false,
                start: '2015-01-04T08:00:00',
                duration: 'PT30M0S',
                timeZone: null,
                recurrenceRule: {frequency:'yearly', interval:2,byMonth:[0],byDay:[0],byHour:[8,9],byMinute:[30]},
                recurrenceOverrides: null,

                alerts: null
            },
            {
                id: 'cal7',
                state: 'foo',

                calendarId: 'personal',

                title: 'Last weekday of month',
                description: 'After the party of the century',
                location: 'Sydney',
                freeBusyStatus: 'busy',

                isAllDay: false,
                start: '2014-10-31T14:43:00',
                duration: 'PT17M0S',
                timeZone: null,
                recurrenceRule: {
                    frequency: 'monthly',
                    byDay: [ 1, 2, 3, 4, 5 ],
                    bySetPosition: [ -1 ],
                },
                recurrenceOverrides: {
                    '2018-03-29T13:43:00': { excluded: true },
                },

                alerts: null
            },
            {
                id: 'cal8',
                state: 'foo',

                calendarId: 'personal',

                title: 'Repeat five times',
                description: 'But skip the 2nd/4th',
                location: '',
                freeBusyStatus: 'busy',

                isAllDay: true,
                start: '2018-03-21T00:00:00',
                duration: 'P1D',
                timeZone: null,
                recurrenceRule: {
                    frequency: 'daily',
                },
                recurrenceOverrides: {
                    '2018-03-22T00:00:00': { excluded: true },
                    '2018-03-23T00:00:00': {
                        title: 'The middle one (exceptional)'
                    },
                    '2018-03-24T00:00:00': { excluded: true },
                },

                alerts: null
            },
            {
                id: 'cal9',

                calendarId: 'personal',

                title: 'Inclusions test',
                description: '',
                location: '',
                freeBusyStatus: 'busy',

                isAllDay: false,
                start: '2018-03-05T03:00:00',
                duration: 'PT1H0M0S',
                timeZone: 'Australia/Melbourne',
                recurrenceRule: {
                    frequency: 'daily',
                    interval: 10,
                },
                recurrenceOverrides: {
                    '2018-03-08T14:00:00': {},
                    '2018-03-09T14:00:00': {},
                    '2018-03-10T14:00:00': {},
                },

                replyTo: {
                    imip:'mailto:uuid@calendar.bot.fastmail.com',
                },
                participantId: 'neilj@fastmail.fm',
                participants: {
                    'neilj@fastmail.fm': {
                        name: 'Neil Jenkins',
                        email: 'neilj@fastmail.fm',
                        rsvpResponse: 'accepted',
                        roles: [ 'owner', 'chair', 'attendee' ],
                    },
                    'joe@bloggs.com': {
                        name: 'Joe Bloggs',
                        email: 'joe@bloggs.com',
                        rsvpResponse: 'accepted',
                        roles: [ 'attendee' ],
                    },
                    'hohoho@smial.com': {
                        name: 'John Smith',
                        email: 'hohoho@smial.com',
                        rsvpResponse: 'declined',
                        roles: [ 'attendee' ],
                    },
                },

                alerts: null
            },
            {
                id: 'r1',
                calendarId: 'personal',
                title: 'An example where an invalid date (i.e., February 30) is ignored.',
                description: '(2007 EST) January 15,30 (2007 EST) February 15 (2007 EDT) March 15,30',
                location: '',
                freeBusyStatus: 'busy',
                isAllDay: false,
                start: '1997-01-15T09:00:00',
                utcEnd: '1997-01-15T10:00:00',
                timeZone: 'America/New_York',
                recurrenceRule: {
                    frequency: 'monthly',
                    byMonthDay: [ 15, 30 ],
                    count: 5
                },
                recurrenceOverrides: null,
                alerts: null
            },
            //DTSTART;TZID=America/New_York:19970805T090000
            //RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=MO
            {
                id: 'r2',
                calendarId: 'personal',
                title: 'WKST=MO',
                description: '(1997 EDT) August 5,10,19,24',
                location: '',
                freeBusyStatus: 'busy',
                isAllDay: false,
                start: '1997-08-05T09:00:00',
                utcEnd: '1997-08-05T10:00:00',
                timeZone: null,
                recurrenceRule: {
                    frequency: 'weekly',
                    interval: 2,
                    byDay: [ 0, 2 ],
                    count: 4
                },
                recurrenceOverrides: null,
                alerts: null
            },
            //DTSTART;TZID=America/New_York:19970805T090000
            //RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=MO
            {
                id: 'r3',
                calendarId: 'personal',
                title: 'WKST=SU',
                description: '(1997 EDT) August 5,17,19,31',
                location: '',
                freeBusyStatus: 'busy',
                isAllDay: false,
                start: '1997-08-05T09:00:00',
                utcEnd: '1997-08-05T10:00:00',
                timeZone: null,
                recurrenceRule: {
                    firstDayOfWeek: 0,
                    frequency: 'weekly',
                    interval: 2,
                    byDay: [ 0, 2 ],
                    count: 4
                },
                recurrenceOverrides: null,
                alerts: null
            },
            //DTSTART;TZID=America/New_York:19961105T090000
            //RRULE:FREQ=YEARLY;INTERVAL=4;BYMONTH=11;BYDAY=TU;BYMONTHDAY=2,3,4,5,6,7,8
            {
                id: 'r4',
                calendarId: 'personal',
                title: 'President',
                description: '',
                location: '',
                freeBusyStatus: 'busy',
                isAllDay: false,
                start: '1996-11-05T09:00:00',
                utcEnd: '1996-11-05T10:00:00',
                timeZone: null,
                recurrenceRule: {
                    firstDayOfWeek: 0,
                    frequency: 'yearly',
                    interval: 4,
                    byMonth: [ 10 ],
                    byDay: [ 2 ],
                    byMonthDay: [ 2, 3, 4, 5, 6, 7, 8 ]
                },
                recurrenceOverrides: null,
                alerts: null
            },
            //DTSTART;TZID=America/New_York:19970913T090000
            //RRULE:FREQ=MONTHLY;BYDAY=SA;BYMONTHDAY=7,8,9,10,11,12,13
            {
                id: 'r5',
                calendarId: 'personal',
                title: 'First Sat after Sun',
                description: '',
                location: '',
                freeBusyStatus: 'busy',
                isAllDay: false,
                start: '1997-09-13T09:00:00',
                utcEnd: '1997-09-13T10:00:00',
                timeZone: null,
                recurrenceRule: {
                    frequency: 'monthly',
                    byDay: [ 6 ],
                    byMonthDay: [ 7, 8, 9, 10, 11, 12, 13 ]
                },
                recurrenceOverrides: null,
                alerts: null
            },
            {
                id: 'r6',
                calendarId: 'personal',
                title: 'TZ shift',
                description: '',
                location: '',
                freeBusyStatus: 'busy',
                isAllDay: false,
                start: '2007-03-09T07:30:00',
                utcEnd: '2007-03-09T07:45:00',
                timeZone: 'America/New_York',
                recurrenceRule: {
                    frequency: 'daily',
                    count: 5
                },
                recurrenceOverrides: null,
                alerts: null
            },
            {
                id: 'r7',
                calendarId: 'personal',
                title: 'TZ shift',
                description: '',
                location: '',
                freeBusyStatus: 'busy',
                isAllDay: false,
                start: '2015-04-03T15:30:00',
                utcEnd: '2015-04-03T16:30:00',
                timeZone: 'Australia/Melbourne',
                recurrenceRule: {
                    frequency: 'daily',
                    count: 5
                },
                recurrenceOverrides: null,
                alerts: null
            },
            {
                id: 'calTest',

                calendarId: 'personal',

                title: 'Local end before local start',
                description: '',
                locations: {
                    'foo': {
                        rel: 'start',
                        timeZone: 'Australia/Sydney',
                    },
                    'bar': {
                        rel: 'end',
                        timeZone: 'America/New_York',
                    },
                },
                freeBusyStatus: 'busy',

                isAllDay: false,
                start: '2018-03-02T09:00:00',
                duration: 'PT3H0M0S',
                timeZone: 'Australia/Perth',
                recurrenceRule: null,
                recurrenceOverrides: null,
                alerts: null
            },
            ]
        }]);
    },
    'CalendarEvent/set': function( results, args ) {
        results.push([ 'CalendarEvent/set', confirmCommit( args ) ]);
    },
};

function evaluatePointer ( value, pointer ) {
    if ( !pointer ) {
        return value;
    }
    if ( pointer.charAt( 0 ) !== '/' ) {
        throw new Error( 'Invalid pointer' );
    }
    let token;
    let next = pointer.indexOf( '/', 1 );
    if ( next !== -1 ) {
        token = pointer.slice( 1, next );
        pointer = pointer.slice( next );
    } else {
        token = pointer.slice( 1 );
        pointer = '';
    }
    token = token.replace( /~1/g, '/' ).replace( /~0/g, '~' );
    if ( Array.isArray( value ) ) {
        if ( /^(?:0|[1-9][0-9]*)$/.test( token ) ) {
            return evaluatePointer( value[ parseInt( token, 10 ) ], pointer );
        }
        /* start: the only bit that differs from RFC6901 */
        if ( token === '*' ) {
            /* Map values to pointer */
            value = value.map( item => evaluatePointer( item, pointer ) );
            /* Flatten output */
            return value.reduce( ( output, item ) => {
                if ( !Array.isArray( item ) ) {
                    item = [ item ];
                }
                return output.concat( item );
            }, [] );
        }
        /* end */
    } else if ( value !== null && typeof value === 'object' ) {
        return evaluatePointer( value[ token ], pointer );
    }
    throw new Error( 'Evaluation failed' );
}

var resolveBackRefs = function ( args, results ) {
    for ( var property in args ) {
        if ( property.charAt( 0 ) === '#' ) {
            var resultOf = args[ property ].resultOf;
            var path = args[ property ].path;
            var result = results.find( function ( result ) {
                return result[2] === resultOf;
            });
            args[ property.slice( 1 ) ] = result ?
                evaluatePointer( result[1], path ) :
                [];
        }
    }
    return args;
};

var XMLHttpRequest = function () {
    this._id = XMLHttpRequest._nextId++;
    this.readyState = 0;
    this.status = 0;
    this.statusText = '';
    this.onreadystatechange = function () {};
};
XMLHttpRequest._nextId = 0;
Object.defineProperty( XMLHttpRequest.prototype, 'response', {
    get: function () {
        return this._response || '';
    },
    set: function ( value ) {
        this._response = value;
        if ( XHR_LOGGING.responses ) {
            if ( this.responseType === 'json' && XHR_LOGGING.stringifyJSON ) {
                console.log( 'Response %s: %s', this._id,
                    JSON.stringify( value, null, 2 ) );
            } else {
                console.log( 'Response %s: %o', this._id, value );
            }
        }
    },
});
XMLHttpRequest.prototype.open = function ( method, url ) {
    this._method = method;
    this._url = url;
};
XMLHttpRequest.prototype.setRequestHeader = function ( name, value ) {
    // console.log( 'Request header: ' + name + ' = ' + value );
};
// Random delay between 200 and 700 ms.
XMLHttpRequest.prototype.send = function ( data ) {
    if ( XHR_LOGGING.requests ) {
        var logged = false;
        if ( !XHR_LOGGING.stringifyJSON ) {
            try {
                console.log( 'Request %s: %o', this._id,
                    JSON.parse( data ) );
                logged = true;
            } catch ( e ) { }
        }
        if ( !logged ) {
            console.log( 'Request %s: %s', this._id, data );
        }
    }
    if ( this._url === '/log/error' ) {
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
XMLHttpRequest.prototype.withCredentials = true;
XMLHttpRequest.prototype._returnResultForData = function ( data ) {
    this.readyState = 4;
    if ( this._url === '/jmap/upload/' ) {
        var name = data.name;
        var blobId = '' + ~~( 100000000 * Math.random() );
        var size = ~~( 100000 * Math.random() );
        var ext = name.split( '.' ).pop();
        var type = {
            'doc': 'application/word',
            'jpg': 'image/jpg',
            'pdf': 'application/pdf',
            'png': 'image/png',
            'txt': 'text/plain'
        }[ ext ] || 'application/octet-stream';
        var isImage = ext === 'png' || ext === 'jpg';
        // if ( Math.random() <= 0.95 ) {
            this.status = 200;
            this.response =  {
              // name:asmail.fm/temp/ae65bdd91230ae9bbc1.pdf",
              // url: "https://fmusercontent.com/ae65bdd91230ae9bbc1/mydocument.pdf",
              type: type,
              name: name,
              size: size,
              expires: new Date().add( 1, 'month' ).toJSON(),
              blobId: blobId,
              width: isImage ? ~~( 1024 * Math.random() ) : null,
              height: isImage ? ~~( 768 * Math.random() ) : null
            };
        // } else {
        //     this.status = 400;
        //     this.responseText = JSON.stringify( [ [ 'upload', {
        //         error: "Something bad happened!"
        //     }]] );
        // }
        this.onreadystatechange();
        return;
    }

    var methods = [];
    try {
        methods = JSON.parse( data ).methodCalls || [];
    } catch ( error ) {}
    var result = [];
    var k = 0, kk;
    for ( var i = 0, l = methods.length; i < l; i += 1 ) {
        var call = methods[i];
        var method = call[0];
        var args = call[1];
        var tag = call[2];
        var accountId = args.accountId;

        args = resolveBackRefs( args, result );
        API[ method ] && API[ method ]( result, args );

        for ( kk = result.length; k < kk; k += 1 ) {
            result[k][1].accountId = accountId;
            result[k][2] = tag;
        }
    }
    // Simulate 10% errors:
    // this.status = Math.random() > 0.9 ? 400 : 200;
    this.status = 200;
    this.response = { methodResponses: result };
    // console.log( JSON.stringify( result, function ( key, value ) {
    //     return key !== 'headersList' && key !== 'conversations' ? value : undefined;
    // }, 2 ) );
    this.onreadystatechange();
};

window.XMLHttpRequest = XMLHttpRequest;

}() );
