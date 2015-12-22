import React from 'react';
import styles from './App.css';

export default class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {test: 'foo'};
  }
  render() {
    return (
      <div className={styles.app}>
        <h1>Welcome to Relate Chat's Twilio / Zendesk conversion API</h1> 
      </div>
    );
  }
}
