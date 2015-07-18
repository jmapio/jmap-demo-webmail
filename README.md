# JMAP Demo Webmail

This is a simple, but in many ways surprisingly sophisticated demo webmail client, making use of the [JMAP JS library](https://github.com/jmapio/jmap-js), and built on top of the [Overture library](https://github.com/fastmail/overture). Hopefully this will make it easier for people to start hacking on JMAP immediately and get a feel for it. There's less than 2000 lines of non-library code - and that includes generous spacing and a few comments.

There's a hosted version at http://proxy.jmap.io, which uses the [JMAP proxy](https://github.com/jmapio/jmap-perl) to provide a JMAP interface to a Gmail or IMAP account.

The app showcases a number of features from the JMAP JS library:

1. It's fast. Because JMAP can load pretty much any view in one round trip.

2. You have full access to a complete mailbox, with no paging. Jump to any point and the data loads in quickly. The library is actually automatically prefetching a little bit either side of the section you currently need, so scrolling through it gives the illusion of a fully loaded mailbox.

3. All changes update the local UI instantly, then sync to the server in the background. If the server rejects the changes, the library will automatically revert the local cache so it stays in sync.

4. There's full, multi-level undo (and redo – Cmd-Shift-Z!) support. Again, the changes occur instantly in the client and are synced back to the server later. It can even handle undo when it's in the middle of syncing the original change to the server.

5. There's full push support. The EventSource connection to the server receives a new state token whenever something changes, which triggers the library to make a request to the server and get back the changes. Very fast, very efficient.

## Installation

Clone the git repo, open index.html – it will talk to a basic simulated JMAP server (see fixtures.js) so you can try it locally. To talk to a real server, comment out the fixtures.js file in index.html, and modify the `JMAP.auth.didAuthenticate` call in state.js to tell it where to connect to.

## License

All code and design is made available under the liberal MIT license. Please see the LICENSE file in the repo for full details.
