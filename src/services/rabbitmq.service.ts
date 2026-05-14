import amqp from 'amqplib'
import { config } from '../config'

class RabbitMQService {
  private connection?: amqp.Connection
  private channel?: amqp.Channel

  async connect() {
    if (this.connection) return

    // The correct return type is ChannelModel, not Connection
    const connection = await amqp.connect(config.rabbitmq.url!)
    this.connection = connection as any // Type assertion workaround
    this.channel = await connection.createChannel()

    console.log('[RabbitMQ] connected')
  }

  async getChannel(): Promise<amqp.Channel> {
    if (!this.channel) {
      await this.connect()
    }
    return this.channel!
  }
}

export const rabbitmqService = new RabbitMQService()