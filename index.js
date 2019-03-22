// Copyright 2019 The FairDataSociety Authors
// This file is part of the FairDataSociety library.
//
// The FairDataSociety library is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// The FairDataSociety library is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with the FairDataSociety library. If not, see <http://www.gnu.org/licenses/>.

require('dotenv').config();

let express = require('express');
let bodyParser = require('body-parser');
let ethers = require('ethers');
let cors = require('cors');

let utils = ethers.utils;

let privateKey = process.env.PRIVATE_KEY;
let provider = new ethers.providers.JsonRpcProvider(process.env.ETH_GATEWAY);

let dripAmt = utils.parseEther(process.env.DRIP_AMT);

const app = express();
const port = process.env.PORT || '3001';

var redis = require('redis');
var client = redis.createClient(process.env.REDIS_URL);
console.log(process.env.REDIS_URL)

app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());

let wallet = new ethers.Wallet(privateKey, provider);

wallet.getBalance().then((balance)=>{
  console.log(process.env.ETH_GATEWAY);
  console.log(wallet.address, balance.toString());
});

let gimmieEth = function(privateKey, address, amt, reset){
  return new Promise((resolve, reject) => {

    return client.incr('current-nonce',(err,v)=>{
      if(err){reject(err)};
      console.log('nonce', v);
      let transaction = {
          gas: 4712388,
          gasLimit: 50000,
          gasPrice: 100000000000,
          to: address,
          value: amt,
          nonce: v-1
      }
      let signPromise = wallet.sign(transaction);
      return signPromise.then((signedTransaction) => {
          return provider.sendTransaction(signedTransaction).then((tx) => {
              console.log('sent', tx);
              let checkInterval = setInterval(()=>{
                provider.getTransaction(tx.hash).then((gotTx)=>{
                  console.log(tx.hash, gotTx.confirmations);
                  if(gotTx.confirmations > 0){
                    console.log('confirmed', tx);
                    clearInterval(checkInterval);
                    resolve(tx);                    
                  }
                })
              },3000);
              return;
          }).catch((error)=>{
            reject(error.message);
            return
          });
      });

    }); 
  });
};

app.get('/',(req, res) => {
  let token = process.env.AUTH_TOKEN.substr(-10);
  if(req.body.token && req.body.token === token){  
    return provider.getTransactionCount(wallet.address).then((transactionCount) => {
        res.send({
          dripAmt: process.env.DRIP_AMT,
          transactionCount: transactionCount
        });
      });
  }else{
    res.send({
      dripAmt: process.env.DRIP_AMT
    });
  }
});

app.post('/gimmie', (req, res) => {
  let recipient = req.body.address;
  let reset = req.body.reset_nonce === 'true';
  console.log('requested: ' + recipient)
  gimmieEth(privateKey, recipient, dripAmt, reset).then((tx)=>{
    res.send({
      result: true,
      gifted: utils.formatEther(dripAmt),
      transaction: tx.hash
    });
  }).catch(error => {
    res.status(500).send({
      result: false,
      error: error
    });
  });
});

app.post('/reset', (req, res) => {
  let token = process.env.AUTH_TOKEN;
  if(req.body.token === token){
    return provider.getTransactionCount(wallet.address).then((transactionCount) => {
      let nonce = parseInt(req.body.nonce) >= 0 ? parseInt(req.body.nonce) : transactionCount;
      return new Promise((resolve, reject)=>{
        console.log('resetting nonce to ', nonce);
        client.set("current-nonce", nonce, (err,v)=>{
          res.send({
            result: true,
            newNonce: nonce,
            transactionCount: transactionCount
          });
        });
      }); 
    });
  }else{
    res.status(500).send({
      result: false,
    });    
  }
});

app.listen(port, () => console.log(`Faucet dripping on port ${port}!`));

// curl -XPOST localhost:3001/gimmie --data "address=0x972e45b1e7e468466276305ab20e4cb09b1ad0e6"
