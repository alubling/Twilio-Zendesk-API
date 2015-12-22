import express from 'express';
import dotenv from 'dotenv';
import twilio from 'twilio';
import zendesk from 'node-zendesk';

const router = express.Router();
dotenv.load();

// create an authenticated client to access the Twilio REST API
let twilioclient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// create an authenticated client to access the Zendesk REST API
let zenclient = zendesk.createClient({
  username:  process.env.ZENDESK_USERNAME,
  token:     process.env.ZENDESK_AUTH_TOKEN,
  remoteUri: process.env.ZENDESK_URI
});


// handle a GET request that listens for a Zendesk webhook of a ticket response and sends it as a text message.
router.get('/', function(request, response) {

    console.log('making it to the /message route root');

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
        response.send('Message is inbound!');
    });

    // Use the REST client to get a list of tickets
    zenclient.users.list(function (err, req, res) {
      if (err) {
        console.log(err);
        return;
      }
      console.log(JSON.stringify(res[0], null, 2, true));//gets the first page
    });
});

module.exports = router;
