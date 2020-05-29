'use strict';

const AWS = require('aws-sdk');
AWS.config.update({ region: "eu-central-1"});
const db = new AWS.DynamoDB.DocumentClient({region: "eu-central-1"});
const { parsePhoneNumber, ParseError } = require('libphonenumber-js')

const Mpesa = require('mpesa-node');

const mpesaApi = new Mpesa({
    consumerKey: process.env.MPESA_CONSUMER_KEY,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET ,
    environment: process.env.MPESA_ENV,
    shortCode: process.env.MPESA_SHORTCODE,
    initiatorName: process.env.MPESA_INITIATOR_NAME,
    lipaNaMpesaShortCode: process.env.MPESA_LNM_SHORTCODE,
    lipaNaMpesaShortPass: process.env.MPESA_LNM_SHORTPASS,
    securityCredential: process.env.MPESA_SECURITY_CREDS'
});

const prettyjson = require('prettyjson');
var options = { noColor: true };

var randomstring = require("randomstring");
var tinyURL = require('tinyurl');
// var twilio = require('twilio');

const iv = process.env.CRYPTO_IV_KEY;
const enc_decr_fn = process.env.ENC_DECR_ALGO;
const  phone_hash_fn = process.env.MSISDN_HASH_ALGO;

// AFRICASTALKING API
const AT_credentials = {
  apiKey: process.env.AT_SMS_API_KEY,
  username: process.env.AT_API_USERNAME
}

// const AfricasTalking = require('africastalking')(AT_credentials);
// const sms = AfricasTalking.SMS;
const AfricasTalking = require('./africastalking')(AT_credentials);
const sms = AfricasTalking.SMS;

// CElO init
const contractkit = require('@celo/contractkit');
const { isValidPrivate, privateToAddress, privateToPublic, pubToAddress, toChecksumAddress } = require ('ethereumjs-util');
const bip39 = require('bip39-light');
const crypto = require('crypto');

const NODE_URL = 'https://alfajores-forno.celo-testnet.org'; //'https://baklava-forno.celo-testnet.org'
const kit = contractkit.newKit(NODE_URL);

const trimLeading0x = (input) => (input.startsWith('0x') ? input.slice(2) : input);
const ensureLeading0x = (input) => (input.startsWith('0x') ? input : `0x${input}`);
const hexToBuffer = (input) => Buffer.from(trimLeading0x(input), 'hex');

module.exports.kotaniapi = async (event, context) => {
  var msg = event.body;
  msg = decodeURIComponent(msg);
  
  console.log('Json split', msg);
  
  var jsondata = '{"' + msg.replace(/&/g, '", "').replace(/=/g, '": "') + '"}';
  jsondata = JSON.parse(jsondata);
  
  console.log('event data: => ',jsondata);
     
  let responseBody = "";
  let statusCode = 0;
  
// GLOBAL VARIABLES
  let publicAddress = '';
  let senderMSISDN = ``;
  let receiverMSISDN = ``;
  var recipientId = ``;
  var senderId = ``;
  let amount = ``;

  const phoneNumber = jsondata.phoneNumber;
  console.log('PhoneNumber => ', phoneNumber);
  const text = jsondata.text;
  console.log('Text => ', text);

  var data = text.split('*');
  
  try {
    // const data = await db.get(params).promise();
    // var data = text.split('*');
    
   if (text == '') {
        // This is the first request. Note how we start the response with CON
        responseBody = `CON Welcome to Kotanipay.
        1. Send Money 
        2. Deposit Funds       
        3. Withdraw Cash 
        6. PayBill or Buy Goods 
        7. My Account`;
    }
    
    //  1. TRANSFER FUNDS #SEND MONEY
    else if ( data[0] == '1' && data[1] == null) { 
        responseBody = `CON Enter Recipient`;
    } else if ( data[0] == '1' && data[1]!== '' && data[2] == null) {  //  TRANSFER && PHONENUMBER
        responseBody = `CON Enter Amount to Send:`;
        
    } else if ( data[0] == '1' && data[1] !== '' && data[2] !== '' ) {//  TRANSFER && PHONENUMBER && AMOUNT
        senderMSISDN = phoneNumber.substring(1);         
        receiverMSISDN = parseMsisdn(data[1]).substring(1); 
        amount = data[2];

        senderId = await getSenderId(senderMSISDN)
        recipientId = await getRecipientId(receiverMSISDN)

        // Check if users exists in API Database:
        let senderstatusresult = await checkIfSenderExists(senderId);
        console.log("Sender Exists? ",senderstatusresult);
        if(senderstatusresult == false){ addUserDataToDB(senderId, senderMSISDN) }

        let recipientstatusresult = await checkIfRecipientExists(recipientId);
        console.log("Recipient Exists? ",recipientstatusresult);
        if(recipientstatusresult == false){ addUserDataToDB(recipientId, receiverMSISDN) }  
        
        // Retrieve User Blockchain Data
        let senderInfo = await getSenderDetails(senderId);
        let senderprivkey = await getSenderPrivateKey(senderInfo.Item.seedKey, senderMSISDN, iv)
        let receiverInfo = await getReceiverDetails(recipientId);

        let hash = await transfercUSD(senderInfo.Item.publicAddress, senderprivkey, receiverInfo.Item.publicAddress, amount);
        let url = await getTxidUrl(hash);
        let message2sender = `KES ${amount}  sent to ${receiverMSISDN} Celo Account.
          Transaction URL:  ${url}`;
        let message2receiver = `You have received KES ${amount} from ${senderMSISDN} Celo Account.
          Transaction URL:  ${url}`;
        sendMessage("+"+senderMSISDN, message2sender);
        sendMessage("+"+receiverMSISDN, message2receiver);

        responseBody = `END KES `+amount+` sent to `+receiverMSISDN+` Celo Account
        => Transaction Details: ${url}`;        
    } 
    
//  2. DEPOSIT FUNDS
    else if ( data[0] == '2' && data[1] == null) { 
        responseBody = `CON Enter Amount to Deposit`;
    } else if ( data[0] == '2' && data[1]!== '') {  //  DEPOSIT && AMOUNT
        let depositMSISDN = phoneNumber.substring(1);  // phoneNumber to send sms notifications
        amount = `${data[1]}`; 
        let mpesaDeposit = await mpesaSTKpush(depositMSISDN, data[1])    //calling mpesakit library  
        console.log('Is Mpesa Deposit successful: ',mpesaDeposit);
        let escrowMSISDN = process.env.ESCROW_MSISDN;
        
        let escrowId = await getSenderId(escrowMSISDN)
        let depositorId = await getRecipientId(depositMSISDN)

        let depositorstatusresult = await checkIfRecipientExists(depositorId);
        console.log("Recipient Exists? ",depositorstatusresult);
        if(depositorstatusresult == false){ addUserDataToDB(depositorId, depositMSISDN) }  
        
        let escrowInfo = await getSenderDetails(escrowId);
        
        let escrowprivkey = await getSenderPrivateKey(escrowInfo.Item.seedKey, escrowMSISDN, iv)

        let receiverInfo = await getReceiverDetails(depositorId);
        console.log('Receiver Address => ', receiverInfo.Item.publicAddress);          

        let hash = await transfercUSD(escrowInfo.Item.publicAddress, escrowprivkey, receiverInfo.Item.publicAddress, amount)
        let url = await getTxidUrl(hash);
        console.log('Transaction URL: ',url)

        responseBody = `END KES `+amount+` sent to `+depositMSISDN+` Celo Account
        => Transaction Details: ${url}`;
        
        let message2depositor = `You have deposited KES ${amount} to ${depositMSISDN} Celo Account.
          Transaction URL:  ${url}`;
        sendMessage("+" +depositMSISDN, message2depositor);        
    }

//  3. WITHDRAW FUNDS
    else if ( data[0] == '3'  && data[1] == null) {
        responseBody = `CON Enter Amount to Withdraw`;
    }else if ( data[0] == '3' && data[1]!== '') {  //  WITHDRAW && AMOUNT
        senderMSISDN = phoneNumber.substring(1);  
        amount = `${data[1]*100000000}`; 
        mpesa2customer(senderMSISDN, data[1])    
        
        responseBody = `END You have withdrawn KES: `+data[1]+` from account: `+phoneNumber.substring(1);        
    }


//  5. LOANS and SAVINGS
    else if ( data[0] == '5' && data[1] == null) {
      // Business logic for first level response
      responseBody = `CON Choose Investment Option
      1. Buy/Sell cGOLD
      2. Buy/Sell Bitcoin
      3. Buy/Sell Ethereum
      4. Buy/Sell EOS`;
  }else if ( data[0] == '5' && data[1] == '1') {
      let userMSISDN = phoneNumber.substring(1);
      responseBody = await getAccDetails(userMSISDN);        
  }else if ( data[0] == '5'  && data[1] == '2') {
      let userMSISDN = phoneNumber.substring(1);
      responseBody = `END Coming soon`;        
  }else if ( data[0] == '5'  && data[1] == '3') {
    let userMSISDN = phoneNumber.substring(1);
    responseBody = `END Coming soon`;        
}

//  6. PAYBILL or BUY GOODS
    else if ( data[0] == '6' && data[1] == null) {
      responseBody = `CON Select Option:
      1. Buy Airtime
      2. PayBill
      3. Buy Goods`;
  }
  //  6.1: BUY AIRTIME
  else if ( data[0] == '6' && data[1] == '1' && data[2] == null) { //  REQUEST && AMOUNT
      responseBody = `CON Enter Amount:`;       
  }else if ( data[0] == '6' && data[1] == '1' && data[2]!== '') { 
      responseBody = `END Buying KES ${data[2]} worth of airtime for: `+phoneNumber;        
  }

  //  6.2: PAY BILL  
  else if ( data[0] == '6' && data[1] == '2') {
      responseBody = `END PayBill feature Coming soon`;        
  }

  //  6.1: BUY GOODS
  else if ( data[0] == '6'  && data[1] == '3') {
      let userMSISDN = phoneNumber.substring(1);
      responseBody = `END BuyGoods feature Coming soon`;        
  }
//   else if ( data[0] == '7'  && data[1] == '3') {
//     let userMSISDN = phoneNumber.substring(1);
//     responseBody = await getSeedKey(userMSISDN);        
// }
        

//  7. ACCOUNT DETAILS
    else if ( data[0] == '7' && data[1] == null) {
        // Business logic for first level response
        responseBody = `CON Choose account information you want to view
        1. Account Details
        2. Account balance
        3. Account Backup`;
    }else if ( data[0] == '7' && data[1] == '1') {
        let userMSISDN = phoneNumber.substring(1);
        responseBody = await getAccDetails(userMSISDN);        
    }else if ( data[0] == '7'  && data[1] == '2') {
        let userMSISDN = phoneNumber.substring(1);
        responseBody = await getAccBalance(userMSISDN);        
    }else if ( data[0] == '7'  && data[1] == '3') {
      let userMSISDN = phoneNumber.substring(1);
      responseBody = await getSeedKey(userMSISDN);        
  }
  else{
    // text == '';
    responseBody = `END Sorry, I dont understand your option`;
  }
    
    
    statusCode = 201;
  } catch(err) {
    responseBody = `Unable to put product: ${err}`;
    statusCode = 403;
  }

  const response = {
    statusCode: statusCode,
    headers: { "Content-Type": "text/plain" },
    body: responseBody
  };

  return response;
};

function sendMessage(to, message) {
  const params = {
      to: [to],
      message: message,
      from: 'KotaniPay'
  }
  sms.send(params)
      .then(msg=>console.log(prettyjson.render(msg, options)))
      .catch(console.log);
}


function arraytojson(item, index, arr) {
  arr[index] = item.replace(/=/g, '": "');
}

function stringToObj (string) {
  var obj = {}; 
  var stringArray = string.split('&'); 
  for(var i = 0; i < stringArray.length; i++){ 
    var kvp = stringArray[i].split('=');
    if(kvp[1]){
     obj[kvp[0]] = kvp[1] 
    }
  }
  return obj;
}


//USSD APP
async function getAccBalance(userMSISDN){
    let userId  = await getSenderId(userMSISDN)

    let userstatusresult = await checkIfSenderExists(userId);
    if(userstatusresult == false){ addUserDataToDB(userId, userMSISDN) }    
  
    let userInfo = await getSenderDetails(userId);
    console.log('User Address => ', userInfo.Item.publicAddress);
  
    const stableTokenWrapper = await kit.contracts.getStableToken()
    let cUSDBalance = await stableTokenWrapper.balanceOf(userInfo.Item.publicAddress) // In cUSD
    cUSDBalance = kit.web3.utils.fromWei(cUSDBalance.toString(), 'ether');
    console.info(`Account balance of ${cUSDBalance.toString()}`)
    const goldTokenWrapper = await kit.contracts.getGoldToken()
    let cGoldBalance = await goldTokenWrapper.balanceOf(userInfo.Item.publicAddress) // In cGLD
    cGoldBalance = kit.web3.utils.fromWei(cGoldBalance.toString(), 'ether');    
    console.info(`Account balance of ${cGoldBalance.toString()}`)

    return `END Your Account Balance is:
             Kenya Shillings: ${cUSDBalance*100}`;   //Celo Dollar: ${cUSDBalance} cUSD`;
             // Celo Gold: ${cGoldBalance} cGLD`;
}

async function getAccDetails(userMSISDN){
    let userId = await getSenderId(userMSISDN);
    let userstatusresult = await checkIfSenderExists(userId);
    if(userstatusresult == false){ addUserDataToDB(userId, userMSISDN) } 
    let userInfo = await getSenderDetails(userId);
    let url = await getAddressUrl(`${userInfo.Item.publicAddress}`)
    return `END Your Account Number is: ${userMSISDN}
                ...Account Address is: ${url}`;
}

async function getSenderPrivateKey(seedCypher, senderMSISDN, iv){
  let senderSeed = await decrypt(seedCypher, senderMSISDN, iv);
  let senderprivkey =  `${await generatePrivKey(senderSeed)}`;
  return new Promise(resolve => {  
    resolve (senderprivkey)        
  }); 
}

async function getSeedKey(userMSISDN){
  let userId = await getSenderId(userMSISDN);
  let userstatusresult = await checkIfSenderExists(userId);
  if(userstatusresult == false){ addUserDataToDB(userId, userMSISDN) } 
  let userInfo = await getSenderDetails(userId);          
  return `END Your Backup Phrase is: ${userInfo.Item.seedKey}`;
}

async function USSDgetAccountDetails(phoneNumber){
    let userMSISDN = phoneNumber;
    let userId = await getRecipientId(userMSISDN)
    let accAddress = await getReceiverDetails(userId)
    let url = await getAddressUrl(accAddress)
    return `END Your Account Number is: ${userMSISDN}
                ...Account Address is: ${url}`;
}

async function transfercGOLD(senderId, recipientId, amount){
    try{
      let senderInfo = await getSenderDetails(senderId);
      let senderprivkey =  `${await generatePrivKey(senderInfo.seedKey)}`;
      let receiverInfo = await getReceiverDetails(recipientId); 
      let cGLDAmount = `${amount*10000000}`;
      sendcGold(`${senderInfo.SenderAddress}`, `${receiverInfo.receiverAddress}`, cGLDAmount, senderprivkey)
    }
    catch(err){console.log(err)}
}
  
async function transfercUSDx(senderId, recipientId, amount){
    try{
      let senderInfo = await getSenderDetails(senderId);
      console.log('senderInfo: ', senderInfo)
      // let senderprivkey =  `${await generatePrivKey(senderInfo.seedKey)}`;
      // console.log('Sender Private Key: ',senderprivkey)
      // console.log('Sender Adress: ', senderInfo.SenderAddress);
      // //console.log('Sender seedkey: ', senderInfo.seedKey);
      // let receiverInfo = await getReceiverDetails(recipientId);
      // console.log('Receiver Adress: ', receiverInfo.receiverAddress);
      // let cUSDAmount = amount*0.01;
      // console.log('cUSD Amount: ', cUSDAmount);
      // return sendcUSD(`${senderInfo.SenderAddress}`, `${receiverInfo.receiverAddress}`, cUSDAmount, senderprivkey);
    }
    catch(err){console.log(err)}
}

async function transfercUSD(sender, senderprivkey, receiver, amount){
  try{
      let cUSDAmount = amount*0.01;
     return sendcUSD(`${sender}`, `${receiver}`, cUSDAmount, `${senderprivkey}`);
  }
  catch(err){console.log(err)}
}
  
async function checkIfUserExists(userId){
    const params = {
      TableName: process.env.ACCOUNTS_TABLE,
      Key: { userid: userId, },
    };

    var exists;
    try{
      let result = await db.get(params).promise();
      if (result.Item == undefined) {
        exists = false;
      }else{
        exists = true;
      }
      return exists;
    } 
    catch (err) {
      console.log('Error fetching user data: ', err);
    }     
 }  

function getPinFromUser(){
  return new Promise(resolve => {    
    let loginpin = randomstring.generate({ length: 5, charset: 'numeric' });
    resolve (loginpin);
  });
}
  
async function addUserDataToDB(userId, userMSISDN){   
    // responseBody = `CON Enter PIN`;
    // let logigpin = await generateLoginPin();

    let loginpin = await generateLoginPin(); 
    let mnemonic = await bip39.generateMnemonic(256);
    var enc_seed = await encrypt(mnemonic, userMSISDN, iv);
    let publicAddress = await getPublicAddress(mnemonic);
    
    const params = {
      TableName: process.env.ACCOUNTS_TABLE,
      Item: {
        userid: userId,
        seedKey: `${enc_seed}`,
        publicAddress: `${publicAddress}`,
        userLoginPin: loginpin,
      },
    };

    try {
      const data = await db.put(params).promise();
      // signupDeposit(publicAddress);
    } catch (err) {
      console.log(err);
    }
}

async function signupDeposit(publicAddress){
  let escrowMSISDN = process.env.ESCROW_MSISDN;
  let amount = 10;
  let escrowId = await getSenderId(escrowMSISDN);

  let escrowInfo = await getSenderDetails(escrowId);

  let seedkey = await decrypt(escrowInfo.Item.seedKey, escrowMSISDN, iv)
  let senderprivkey = await getSenderPrivateKey(seedkey, escrowMSISDN, iv)

  let hash = await transfercUSD(escrowInfo.Item.publicAddress, senderprivkey, publicAddress, amount)
  let url = await getTxidUrl(hash);
  console.log('Transaction URL: ',url)
}


function getEncryptKey(userMSISDN){
  const hash_fn = process.env.KEY_HASH_ALGO;
  return crypto.createHash(hash_fn).update(userMSISDN).digest('hex');
}

function encrypt(text, userMSISDN, iv){
  let key = getEncryptKey(userMSISDN);
  var cipher = crypto.createCipher(enc_decr_fn, key, iv);
  var crypted = cipher.update(text,'utf8','hex');
  crypted += cipher.final('hex');
  return new Promise(resolve => {  
    resolve (crypted)        
  });  
}

function decrypt(text, userMSISDN, iv){    
  let key = getEncryptKey(userMSISDN);
  var decipher = crypto.createDecipher(enc_decr_fn, key, iv);
  var dec = decipher.update(text,'hex','utf8');
  dec += decipher.final('utf8');
  return new Promise(resolve => {
    resolve (dec)        
  });
}

async function getSenderDetails(senderId){
  const params = {
    TableName: process.env.ACCOUNTS_TABLE,
    Key: { userid: senderId, },
  };
   
  let result = await db.get(params).promise();
  return result;    
}

//SEND GET shortURL
async function getTxidUrl(txid){
   return await getSentTxidUrl(txid);
}

function getSentTxidUrl(txid){      
    return new Promise(resolve => {    
        const sourceURL = `https://alfajores-blockscout.celo-testnet.org/tx/${txid}/token_transfers`;
        resolve (tinyURL.shorten(sourceURL))        
    });
}

//GET ACCOUNT ADDRESS shortURL
async function getAddressUrl(userAddress){
    return await getUserAddressUrl(userAddress);
}

function getUserAddressUrl(userAddress){
    return new Promise(resolve => {    
      const sourceURL = `https://alfajores-blockscout.celo-testnet.org/address/${userAddress}/tokens`;
      resolve (tinyURL.shorten(sourceURL));
    });   
}
  
async function getReceiverDetails(recipientId){
  const params = {
    TableName: process.env.ACCOUNTS_TABLE,
    Key: { userid: recipientId, },
  };
  let result = await db.get(params).promise();
  return result;  
}

function parseMsisdn(userMSISDN){
  try {
      e64phoneNumber = parsePhoneNumber(`${userMSISDN}`, 'KE') 
  } catch (error) {
      if (error instanceof ParseError) {
          // Not a phone number, non-existent country, etc.
          console.log(error.message)
      } else {
          throw error
      }
  }
  return e64phoneNumber.number;    
}

function getSenderId(senderMSISDN){
  return new Promise(resolve => {
    let senderId = crypto.createHash(phone_hash_fn).update(senderMSISDN).digest('hex');
    resolve(senderId);
  });
} 
  
function getRecipientId(receiverMSISDN){
  return new Promise(resolve => {
      let recipientId = crypto.createHash(phone_hash_fn).update(receiverMSISDN).digest('hex');
      resolve(recipientId);
  });
} 

async function checkIfSenderExists(senderId){      
  return await checkIfUserExists(senderId);
}

async function checkIfRecipientExists(recipientId){    
  return await checkIfUserExists(recipientId);
}
      
function generateLoginPin(){
  return new Promise(resolve => {    
    let loginpin = randomstring.generate({ length: 5, charset: 'numeric' });
    resolve (loginpin);
  });
}  
  
  
  
//MPESA LIBRARIES
async function mpesaSTKpush(phoneNumber, amount){
    const accountRef = Math.random().toString(35).substr(2, 7);
    //const URL = "https://us-central1-kotanicelo.cloudfunctions.net/mpesaCallback";
    const URL = "https://us-central1-yehtu-1de60.cloudfunctions.net/mpesaCallback";
    let txstatus;
    try{
        let result = await mpesaApi.lipaNaMpesaOnline(phoneNumber, amount, URL + '/lipanampesa/success', accountRef)
        // console.log(result);
        if(result.status == 200) {
            // console.log('Mpesa Response...:',result);
            console.log('Transaction Request Successful');
            txstatus = true;
        }else{
            console.log('Transaction Request Failed');
            txstatus = false;
        }
    }
    catch(err){
        console.log(err)
    }
    return txstatus;
    
}

async function mpesa2customer(phoneNumber, amount){  
    const URL = 'https://us-central1-yehtu-1de60.cloudfunctions.net/mpesaCallback';    
    
    try{
    const { shortCode } = mpesaApi.configs;
    const testMSISDN = phoneNumber;
    console.log('Recipient: ',testMSISDN);
    console.log('Shortcode: ',shortCode);
    await mpesaApi.b2c(shortCode, testMSISDN, amount, URL + '/b2c/timeout', URL + '/b2c/success')
    .then((result) => { console.log('Mpesa Response...:',result); })
      
    } catch(err){}
}

  

  //CELOKIT FUNCTIONS
async function getPublicAddress(mnemonic){
    let privateKey = await generatePrivKey(mnemonic);
    return new Promise(resolve => { 
        resolve (getAccAddress(getPublicKey(privateKey)));
      });
}

async function generatePrivKey(mnemonic){
    return bip39.mnemonicToSeedHex(mnemonic).substr(0, 64);
}

function getPublicKey(privateKey){
    let privToPubKey = hexToBuffer(privateKey);
    privToPubKey = privateToPublic(privToPubKey).toString('hex');
    privToPubKey = ensureLeading0x(privToPubKey);
    privToPubKey = toChecksumAddress(privToPubKey);
    return privToPubKey;
}

function getAccAddress(publicKey){
    let pubKeyToAddress = hexToBuffer(publicKey);
    pubKeyToAddress = pubToAddress(pubKeyToAddress).toString('hex');
    pubKeyToAddress = ensureLeading0x(pubKeyToAddress);
    pubKeyToAddress = toChecksumAddress(pubKeyToAddress)
    return pubKeyToAddress;   
}

async function sendcGold(sender, receiver, amount, privatekey){
    kit.addAccount(privatekey)

    let goldtoken = await kit.contracts.getGoldToken()
    let tx = await goldtoken.transfer(receiver, amount).send({from: sender})
    let receipt = await tx.waitReceipt()
    console.log('Transaction Details......................\n',prettyjson.render(receipt, options))
    console.log('Transaction ID:..... ', receipt.events.Transfer.transactionHash)

    let balance = await goldtoken.balanceOf(receiver)
    console.log('cGOLD Balance: ',balance.toString())
    return receipt.events.Transfer.transactionHash;
}

async function convertfromWei(value){
    return kit.web3.utils.fromWei(value.toString(), 'ether');
}

async function sendcUSD(sender, receiver, amount, privatekey){
    const weiTransferAmount = kit.web3.utils.toWei(amount.toString(), 'ether')
    const stableTokenWrapper = await kit.contracts.getStableToken()

    const senderBalance = await stableTokenWrapper.balanceOf(sender) // In cUSD
    if (amount > senderBalance) {        
        console.error(`Not enough funds in sender balance to fulfill request: ${await convertfromWei(amount)} > ${await convertfromWei(senderBalance)}`)
        return false
    }
    console.info(`sender balance of ${await convertfromWei(senderBalance)} cUSD is sufficient to fulfill ${await convertfromWei(weiTransferAmount)} cUSD`)

    kit.addAccount(privatekey)
    const stableTokenContract = await kit._web3Contracts.getStableToken()
    const txo = await stableTokenContract.methods.transfer(receiver, weiTransferAmount)
    const tx = await kit.sendTransactionObject(txo, { from: sender })
    console.info(`Sent tx object`)
    const hash = await tx.getHash()
    console.info(`Transferred ${amount} dollars to ${receiver}. Hash: ${hash}`)
    return hash
}

//Get Latest Block
async function getBlock() {
  return kit.web3.eth.getBlock('latest');
}
