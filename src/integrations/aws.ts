/**
 * AWS Adapter - Amazon Web Services integration
 *
 * Provides access to:
 * - CloudWatch logs and metrics
 * - Lambda functions
 * - S3 storage
 * - ECS/EKS services
 */

import { EventBus } from '../core/event-bus.js';

/** AWS configuration */
export interface AWSConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  endpoint?: string;
}

/** CloudWatch log event */
export interface CloudWatchLogEvent {
  timestamp: number;
  message: string;
  ingestionTime: number;
}

/** CloudWatch metric */
export interface CloudWatchMetric {
  namespace: string;
  metricName: string;
  dimensions: Record<string, string>;
  value: number;
  unit: string;
  timestamp: Date;
}

/** Lambda function info */
export interface LambdaFunction {
  name: string;
  arn: string;
  runtime: string;
  handler: string;
  memorySize: number;
  timeout: number;
  lastModified: string;
  state: 'Active' | 'Inactive' | 'Pending' | 'Failed';
}

/** S3 object */
export interface S3Object {
  key: string;
  bucket: string;
  size: number;
  lastModified: Date;
  etag: string;
  contentType?: string;
}

/** ECS service */
export interface ECSService {
  serviceName: string;
  clusterArn: string;
  taskDefinition: string;
  desiredCount: number;
  runningCount: number;
  status: string;
}

/** AWS adapter singleton */
class AWSAdapterClass {
  private config: AWSConfig | null = null;
  private mockMode = false;

  /**
   * Configure the adapter
   */
  configure(config: AWSConfig): void {
    this.config = config;
    console.log('[AWS] Configured for region:', config.region);
  }

  /**
   * Enable mock mode
   */
  enableMockMode(): void {
    this.mockMode = true;
    console.log('[AWS] Mock mode enabled');
  }

  /**
   * Disable mock mode
   */
  disableMockMode(): void {
    this.mockMode = false;
  }

  /**
   * Sign AWS request (simplified)
   */
  private signRequest(
    service: string,
    method: string,
    path: string,
    body?: string
  ): Record<string, string> {
    // In production, use AWS SDK or implement full Sig V4 signing
    // This is a placeholder
    return {
      'Content-Type': 'application/json',
      'X-Amz-Date': new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
    };
  }

  /**
   * Make AWS API request
   */
  private async request<T>(
    service: string,
    action: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    if (!this.config) {
      throw new Error('AWS not configured');
    }

    const endpoint = this.config.endpoint ||
      `https://${service}.${this.config.region}.amazonaws.com`;

    const body = JSON.stringify(params);
    const headers = this.signRequest(service, 'POST', '/', body);
    headers['X-Amz-Target'] = action;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body
    });

    if (!response.ok) {
      throw new Error(`AWS ${service} error: ${response.status}`);
    }

    return response.json();
  }

  // ============ CloudWatch ============

  /**
   * Get CloudWatch logs
   */
  async getLogEvents(
    logGroupName: string,
    logStreamName: string,
    options?: {
      startTime?: number;
      endTime?: number;
      limit?: number;
    }
  ): Promise<CloudWatchLogEvent[]> {
    if (this.mockMode) {
      return this.mockLogEvents();
    }

    const response = await this.request<{
      events: Array<{
        timestamp: number;
        message: string;
        ingestionTime: number;
      }>;
    }>('logs', 'Logs_20140328.GetLogEvents', {
      logGroupName,
      logStreamName,
      startTime: options?.startTime,
      endTime: options?.endTime,
      limit: options?.limit || 100
    });

    return response.events;
  }

  /**
   * Get CloudWatch metrics
   */
  async getMetrics(
    namespace: string,
    metricName: string,
    dimensions: Record<string, string>,
    period: number = 300,
    startTime?: Date,
    endTime?: Date
  ): Promise<CloudWatchMetric[]> {
    if (this.mockMode) {
      return this.mockMetrics(namespace, metricName);
    }

    const response = await this.request<{
      Datapoints: Array<{
        Timestamp: string;
        Average: number;
        Unit: string;
      }>;
    }>('monitoring', 'CloudWatch_20101201.GetMetricStatistics', {
      Namespace: namespace,
      MetricName: metricName,
      Dimensions: Object.entries(dimensions).map(([Name, Value]) => ({ Name, Value })),
      Period: period,
      Statistics: ['Average'],
      StartTime: (startTime || new Date(Date.now() - 3600000)).toISOString(),
      EndTime: (endTime || new Date()).toISOString()
    });

    return response.Datapoints.map(dp => ({
      namespace,
      metricName,
      dimensions,
      value: dp.Average,
      unit: dp.Unit,
      timestamp: new Date(dp.Timestamp)
    }));
  }

  // ============ Lambda ============

  /**
   * List Lambda functions
   */
  async listLambdaFunctions(): Promise<LambdaFunction[]> {
    if (this.mockMode) {
      return this.mockLambdaFunctions();
    }

    const response = await this.request<{
      Functions: Array<{
        FunctionName: string;
        FunctionArn: string;
        Runtime: string;
        Handler: string;
        MemorySize: number;
        Timeout: number;
        LastModified: string;
        State: string;
      }>;
    }>('lambda', 'Lambda_20150331.ListFunctions', {});

    return response.Functions.map(f => ({
      name: f.FunctionName,
      arn: f.FunctionArn,
      runtime: f.Runtime,
      handler: f.Handler,
      memorySize: f.MemorySize,
      timeout: f.Timeout,
      lastModified: f.LastModified,
      state: f.State as 'Active' | 'Inactive' | 'Pending' | 'Failed'
    }));
  }

  /**
   * Invoke Lambda function
   */
  async invokeLambda(
    functionName: string,
    payload: unknown
  ): Promise<{ statusCode: number; result: unknown }> {
    if (this.mockMode) {
      return { statusCode: 200, result: { mock: true } };
    }

    const response = await this.request<{
      StatusCode: number;
      Payload: string;
    }>('lambda', 'Lambda_20150331.Invoke', {
      FunctionName: functionName,
      Payload: JSON.stringify(payload)
    });

    EventBus.emit('aws:lambda:invoked', { functionName });

    return {
      statusCode: response.StatusCode,
      result: JSON.parse(response.Payload)
    };
  }

  // ============ S3 ============

  /**
   * List S3 objects
   */
  async listS3Objects(
    bucket: string,
    prefix?: string
  ): Promise<S3Object[]> {
    if (this.mockMode) {
      return this.mockS3Objects(bucket);
    }

    const response = await this.request<{
      Contents: Array<{
        Key: string;
        Size: number;
        LastModified: string;
        ETag: string;
      }>;
    }>('s3', 'ListObjectsV2', {
      Bucket: bucket,
      Prefix: prefix
    });

    return response.Contents.map(obj => ({
      key: obj.Key,
      bucket,
      size: obj.Size,
      lastModified: new Date(obj.LastModified),
      etag: obj.ETag
    }));
  }

  // ============ ECS ============

  /**
   * List ECS services
   */
  async listECSServices(clusterArn: string): Promise<ECSService[]> {
    if (this.mockMode) {
      return this.mockECSServices(clusterArn);
    }

    const response = await this.request<{
      services: Array<{
        serviceName: string;
        clusterArn: string;
        taskDefinition: string;
        desiredCount: number;
        runningCount: number;
        status: string;
      }>;
    }>('ecs', 'AmazonEC2ContainerServiceV20141113.DescribeServices', {
      cluster: clusterArn,
      services: []
    });

    return response.services;
  }

  // ============ Mock Data ============

  private mockLogEvents(): CloudWatchLogEvent[] {
    const now = Date.now();
    return [
      { timestamp: now - 60000, message: 'INFO: Request processed', ingestionTime: now - 59000 },
      { timestamp: now - 30000, message: 'INFO: Response sent', ingestionTime: now - 29000 },
      { timestamp: now, message: 'DEBUG: Health check', ingestionTime: now }
    ];
  }

  private mockMetrics(namespace: string, metricName: string): CloudWatchMetric[] {
    return [{
      namespace,
      metricName,
      dimensions: {},
      value: Math.random() * 100,
      unit: 'Count',
      timestamp: new Date()
    }];
  }

  private mockLambdaFunctions(): LambdaFunction[] {
    return [{
      name: 'mock-function',
      arn: 'arn:aws:lambda:us-east-1:123456789:function:mock-function',
      runtime: 'nodejs18.x',
      handler: 'index.handler',
      memorySize: 128,
      timeout: 30,
      lastModified: new Date().toISOString(),
      state: 'Active'
    }];
  }

  private mockS3Objects(bucket: string): S3Object[] {
    return [{
      key: 'mock/file.txt',
      bucket,
      size: 1024,
      lastModified: new Date(),
      etag: '"mock-etag"'
    }];
  }

  private mockECSServices(clusterArn: string): ECSService[] {
    return [{
      serviceName: 'mock-service',
      clusterArn,
      taskDefinition: 'mock-task:1',
      desiredCount: 2,
      runningCount: 2,
      status: 'ACTIVE'
    }];
  }
}

// Export singleton
export const AWSAdapter = new AWSAdapterClass();

// Export class for testing
export { AWSAdapterClass };
