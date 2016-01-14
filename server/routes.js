import express from 'express';
import dotenv from 'dotenv';
import twilio from 'twilio';
import zendesk from 'node-zendesk';
import Prom from 'bluebird';
import path from 'path';

const router = express.Router();
dotenv.load();

// create an authenticated client to access the Twilio REST API
let twilioclient = twilio(process.env.TWILIO_MASTER_ACCOUNT_SID, process.env.TWILIO_MASTER_AUTH_TOKEN);

// create an authenticated client to access the Zendesk REST API
let zenclient = zendesk.createClient({
  username:  process.env.ZENDESK_USERNAME,
  token:     process.env.ZENDESK_AUTH_TOKEN,
  remoteUri: process.env.ZENDESK_URI
});

// handle a POST request from Twilio that is triggered by an incoming SMS to our Twilio number and routes it into Zendesk as a ticket/response
router.post('/', function(request, response) {

  console.log('we have a POST request from Twilio! There is an incoming SMS.');
  console.log('here is the request we received:', JSON.stringify(request.body));
  console.log("trying to get the body message string:", JSON.stringify(request.body.Body));
  console.log("is this the from string?", request.body.From);

  // Determine if the incoming SMS is associated with an existing user or is a new user

  // Parse the phone, email, and message out of the request body
  let requesterPhone = request.body.From;
  console.log('requester phone number is:', requesterPhone);
  let requesterEmail = requesterPhone.slice(1) + "@relatechat.com";
  console.log('requester email is:', requesterEmail);
  let requesterMessage = request.body.Body;

  // Deal with images if there are any
  //let requesterMediaUrl0 = request.body.MediaUrl0;
  //let requesterMediaUrl0 = "/Users/Amit/desktop/Alex.png"
  //console.log('may or may not be a media URL:', requesterMediaUrl0);

  // let getFilename = (url) => {
  //     var index;
  //     for (var i = url.length - 1; i > 0; i--) {
  //         if (url.charAt(i) === '/') {
  //             console.log(i);
  //             index = url.length - i - 1;
  //             break;
  //         }
  //     }
  //     var filename = url.slice(-index);
  //     return filename + ".gif";
  // }
  //let requesterMediaFilename = getFilename(requesterMediaUrl0);
  //let requesterMediaFilename = "Alex.png";
  //console.log('filename of the media URL:', requesterMediaFilename);

  // to do that we need to get all users and manually search because API only allows search by id which we don't have (check with Zendesk on this)
  // router.get(process.env.ZENDESK_URI + '/users.json', function(request, response) {
  //
  // });

  // if the request includes an image, upload a file to Zendesk and get back token(s)
  function uploadAttachmentAsync(requesterMediaUrl0, requesterMediaFilename) {
    return new Promise(function(resolve, reject){
         zenclient.attachments.upload(requesterMediaUrl0, {filename: requesterMediaFilename}, function(err, req, data){

            console.log("made it to the upload attachment promise");
            console.log("attachment returns:", data);

             if (err !== null) {
               console.log("Error uploading attachment", err);
               return reject(err)
             };

             if (!data || data.length === 0) {
                 console.log("returning null");
                 resolve(null);
              } else {
                 console.log("returning attachment token?");
                 resolve(data);
              }

         });
    });
  }

  // search for the user by their email, which is their phone number @relatechat.com, returns the user or null
  function userSearchAsync(){
    return new Promise(function(resolve, reject){
         zenclient.users.search({query: requesterEmail}, function(err, req, data){

            console.log("made it to the alt promisify user search");
            console.log("user search produced:", data);

             if (err !== null) {
               console.log("Error searching for the right user", err);
               return reject(err)
             };

             if (!data || data.length === 0) {
                 console.log("returning null");
                 resolve(null);
              } else {
                 console.log("returning existing user");
                 resolve(data);
              }

         });
    });
  }

  // If it is a new user, create a new user in Zendesk
  function createUserAsync(){
    let user = {
      "user": {
        "name": "Fill this in manually",
        "email": requesterEmail + "",
        "phone": requesterPhone
      }
    };
    return new Promise(function(resolve, reject){
         zenclient.users.create(user, function(err, req, data){
            console.log("made it to the alt promisify create user");
            if (err !== null) {
              console.log("error creating user in Zendesk", err);
              return reject(err)
            };
            console.log("created a user in Zendesk:", JSON.stringify(data, null, 2, true));
            resolve(data);
         });
    });
  }

  // If it is a new user, create a new ticket in Zendesk associated with the new user
  function createTicketAsync(requesterId) {
    let newTicket = {
      "ticket": {
        //"subject":   smsSubject, // SMS only has the sender and the body of the text, no equivalent to subject
        "comment":   { "body": requesterMessage },
        "requester_id": requesterId, // NOT SURE THIS IS WORKING, SO changed from requesterId to requester_id
        "type": "question", // this ensures that the webhook will catch for this ticket
        //"requester": { "locale_id": 1, "name": "Pablo", "email": "pablito@example.org" }
      }
    }
    return new Promise(function(resolve, reject){
         zenclient.tickets.create(newTicket, function(err, req, data){
            console.log("made it to the alt promisify create new ticket");
            if (err !== null) {
              console.log("error creating new ticket in Zendesk", err);
              return reject(err) // do i need a process.exit(-1) here as the returned value?
            };
            console.log("created a new ticket in Zendesk:", JSON.stringify(data, null, 2, true));
            resolve(data);
         });
    });
  }

  // if SMS is from an existing user, search for that user's associated ticket
  function searchForTicketAsync() {
    let query = `type:ticket+requester:${requesterEmail}`;
    return new Promise(function(resolve, reject){
         zenclient.search.requestAll('GET', ['search', '?query=' + query], function(err, req, data){
            console.log("made it to the alt promisify search for existing user's ticket");
            if (err !== null) {
              console.log("error searching for existing user's ticket in Zendesk", err);
              return reject(err) // do i need a process.exit(-1) here as the returned value?
            };
            console.log("found existing user's ticket in Zendesk, or not:", JSON.stringify(data, null, 2, true));
            if (!data || data.length === 0) {
                console.log("returning null if there is no existing ticket");
                resolve(null);
             } else {
                console.log("returning existing ticket if it exists");
                resolve(data);
             }
         });
    });
  }

  // With the existing user's ticket, update the ticket with the new request
  function updateTicketAsync(requesterId, existingTicketId) {
    let updatedTicket = {
      "ticket": {
        "comment":   { "public": true, "body": requesterMessage, "author_id": requesterId },
      }
    }
    return new Promise(function(resolve, reject){
         zenclient.tickets.update(existingTicketId, updatedTicket, function(err, req, data){
            console.log("made it to the alt promisify update the existing user's ticket");
            if (err !== null) {
              console.log("error updating the existing user's ticket in Zendesk", err);
              return reject(err) // do i need a process.exit(-1) here as the returned value?
            };
            console.log("successfully updated the existing user's ticket in Zendesk:", JSON.stringify(data, null, 2, true));
            resolve(data);
         });
    });
  }

  // // search for the user by their email, which is their phone number @relatechat.com, returns the user or null
  // let userSearch = zenclient.users.search({query: requesterEmail}, function (err, req, data) {
  //   if (err) {
  //     console.log("Error searching for the right user", err);
  //     return;
  //   }
  //   console.log("this is the request:", req);
  //   console.log("this is the response:", data);
  //
  //   if (!data || Object.keys({}).length === 0) {
  //
  //     console.log("returning an empty object");
  //     return {};
  //
  //   } else {
  //
  //     console.log("returning existing user");
  //     return data;
  //
  //   }
  //
  // });
  // // Promisify the user search
  // let userSearchAsync = Prom.promisify(userSearch());

  // If it is a new user, create a new user in Zendesk
  // let user = {
  //   "user": {
  //     "name": "Fill this in manually",
  //     "email": requesterEmail
  //   }
  // };
  // let createUser = zenclient.users.create(user, function (err, req, result) {
  //   if (err) {
  //     console.log("error creating user in Zendesk", err);
  //     return;
  //   }
  //   console.log(JSON.stringify(result, null, 2, true));
  //   return result;
  // });
  // // Promisify the user creation
  // let createUserAsync = Prom.promisify(createUser);


  // If it is a new user, create a new ticket in Zendesk associated with the new user
  // let newTicket = {
  //   "ticket": {
  //     //"subject":   smsSubject, // SMS only has the sender and the body of the text, no equivalent to subject
  //     "comment":   { "body": requesterMessage },
  //     "requesterId": requesterId,
  //     "type": "question" // this ensures that the webhook will catch for this ticket
  //     //"requester": { "locale_id": 1, "name": "Pablo", "email": "pablito@example.org" }
  //   }
  // }
  // let createTicket = zenclient.tickets.create(newTicket,  function(err, req, result) {
  //   if (err) return handleError(err);
  //   console.log(JSON.stringify(result, null, 2, true));
  //   return result;
  // });
  // function handleError(err) {
  //     console.log("Error handling ticket creation in Zendesk:", err);
  //     process.exit(-1);
  // }
  // // Promisify the ticket creation
  // let createTicketAsync = Prom.promisify(createTicket);

  // // if SMS is from an existing user, search for that user's associated ticket
  // let query = `requester:${requesterEmail}+type:ticket`;
  // let searchForTicket = zenclient.search.query(query, function (err, req, result) {
  //   if (err) {
  //     console.log("Error running a search query for tickets associated with this user:", err);
  //     return;
  //   }
  //   console.log(JSON.stringify(result, null, 2, true));
  //   return result;
  // });
  // // Promisify the search for the existing ticket associated with that user
  // let searchForTicketAsync = Prom.promisify(searchForTicket);

  // // With the existing user's ticket, update the ticket with the new request
  // let updatedTicket = {
  //   "ticket": {
  //     "comment":   { "public": true, "body": requesterMessage, "author_id": requesterId },
  //   }
  // }
  // let updateTicket = zenclient.tickets.update(existingTicketId, updatedTicket, function(err, req, result) {
  //   if (err) return handleError(err);
  //   console.log(JSON.stringify(result, null, 2, true));
  //   return result;
  // });
  // function handleError(err) {
  //     console.log("Error handling ticket creation in Zendesk:", err);
  //     process.exit(-1);
  // }
  // // Promisify the ticket update
  // let updateTicketAsync = Prom.promisify(updateTicket);


  // Generator that will synchronously run through the api calls
  Prom.coroutine(function* () {
    // if there is an image in the request, upload it as an attachment and return a token or array of tokens
    // if (requesterMediaUrl0) {
    //   console.log("making it to the if we have a mediaURL");
    //   let attachments = yield uploadAttachmentAsync(requesterMediaUrl0, requesterMediaFilename);
    //   console.log("here are the attachments:", attachments);
    // }
    // search for the incoming SMS sender to see if it's an existing user
    let newUser = yield userSearchAsync();
    console.log("what does the user search async return?", newUser);
    // if it is an existing user
    if (newUser) {
      console.log("making it to the coroutine if for an existing user");
      // get the existing user's id
      let existingUser = newUser[0];
      let requesterId = existingUser.id;
      console.log("make sure requesterId is correct:", requesterId);
      // use the existing user's id to search for their existing ticket
      let existingTicket = yield searchForTicketAsync();
      // if the user has no existing ticket, create one
      if (existingTicket === null) {
        existingTicket = yield createTicketAsync(requesterId);
      // if the user has an existing ticket, get it's id and use that to update it with the latest message
      } else {
        let existingTicketId = existingTicket[0].id
        let finalTicket = yield updateTicketAsync(requesterId, existingTicketId);
      }
      //console.log("this is the existing ticket update the generator produced:", finalTicket);
    // if it is a new user
    } else {
      console.log("making it to the coroutine else for a new user");
      // create a new user in Zendesk
      newUser = yield createUserAsync();
      console.log("new user output looks like:", newUser);
      // get that new user's id
      let requesterId = newUser.id;
      // create a new ticket with that new user's id and the message body
      let finalTicket = yield createTicketAsync(requesterId);
      //console.log("this is the new ticket the generator produced:", finalTicket);
    }
  })();

});


// handle a GET request that listens for a Zendesk webhook of a ticket response and sends it out as a text message.
// For now this is just a test to send outgoing SMS and retrieve a list of users from Zendesk
router.get('/', function(request, response) {

    console.log('we have a GET request from the Zendesk webhook, turning it into an outgoing SMS');

    // Use the REST client to send a text message
    twilioclient.sendMessage({
        to: process.env.CLIENT_NUMBER, // request.param('to'), // this pulls the sms number to send to from the param
        from: process.env.TWILIO_NUMBER,
        body: 'Sending a message through Twilio!'
    }, function(err, data) {
        if (err) {
          console.log("error!", err);
        }
        // When we get a response from Twilio, respond to the HTTP POST request
        console.log('here is the data we received:', data);
        response.send('Message is outbound!');
    });

    // Use the REST client to get a list of tickets
    zenclient.users.list(function (err, req, res) {
      if (err) {
        console.log(err);
        return;
      }
      console.log(JSON.stringify(res[0], null, 2, true));//gets the first page
    });

    // Previous ticket search that has an open issue in the Zendesk node library
    // function searchForTicketAsync() {
    //   let query = `requester:${requesterEmail}+type:ticket`;
    //   return new Promise(function(resolve, reject){
    //        zenclient.search.query(query, function(err, req, data){ // This doesnt work per: https://github.com/blakmatrix/node-zendesk/issues/81
    //           console.log("made it to the alt promisify search for existing user's ticket");
    //           if (err !== null) {
    //             console.log("error searching for existing user's ticket in Zendesk", err);
    //             return reject(err) // do i need a process.exit(-1) here as the returned value?
    //           };
    //           console.log("found existing user's ticket in Zendesk, or not:", JSON.stringify(data, null, 2, true));
    //           if (!data || data.length === 0) {
    //               console.log("returning null if there is no existing ticket");
    //               resolve(null);
    //            } else {
    //               console.log("returning existing ticket if it exists");
    //               resolve(data);
    //            }
    //        });
    //   });
    // }

    // Testing the search functionality
           let requesterEmail = `${process.env.CLIENT_NUMBER}@relatechat.com`;
           //let query = `requester:${requesterEmail}+type:ticket`;
           //let query = "type:ticket+status:open";
           //let query = "type:ticket+requester:" + requesterEmail;
           let query = `type:ticket+requester:${requesterEmail}`;
          //  zenclient.search.query(query, function(err, req, data){
          //     console.log("made it to the alt promisify search for existing user's ticket");
          //     if (err !== null) {
          //       console.log("error searching for existing user's ticket in Zendesk", err);
          //       return;
          //       //return reject(err) // do i need a process.exit(-1) here as the returned value?
          //     };
          //     console.log("found existing user's ticket in Zendesk, or not:", JSON.stringify(data, null, 2, true));
          //     if (!data || data.length === 0) {
          //         console.log("returning null if there is no existing ticket");
          //         return;
          //      } else {
          //         console.log("returning existing ticket if it exists");
          //         return data;
          //      }
          //  });

           zenclient.search.requestAll('GET', ['search', '?query=' + query], function(err, req, data) {
             console.log("made it to the alt promisify search for existing user's ticket");
             if (err !== null) {
               console.log("error searching for existing user's ticket in Zendesk", err);
               return;
               //return reject(err) // do i need a process.exit(-1) here as the returned value?
             };
             console.log("found existing user's ticket in Zendesk, or not:", JSON.stringify(data, null, 2, true));
             if (!data || data.length === 0) {
                 console.log("returning null if there is no existing ticket");
                 return;
              } else {
                 console.log("returning existing ticket if it exists");
                 return data;
              }
           });
});


module.exports = router;
