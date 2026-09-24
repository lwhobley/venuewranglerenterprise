import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ScimService, coreUserSchema } from './scim.service';

@Controller('scim/v2')
export class ScimController {
  constructor(private readonly scim: ScimService) {}

  @Get('ServiceProviderConfig')
  serviceProviderConfig() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: 'https://www.rfc-editor.org/rfc/rfc7644',
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 100 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer Token', description: 'Tenant-scoped SCIM bearer token configured in SCIM_PROVIDERS_JSON.', specUri: 'https://www.rfc-editor.org/rfc/rfc6750', primary: true }],
    };
  }

  @Get('ResourceTypes')
  resourceTypes() {
    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 1,
      startIndex: 1,
      itemsPerPage: 1,
      Resources: [{
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'User',
        name: 'User',
        endpoint: '/Users',
        schema: coreUserSchema,
        meta: { location: '/api/scim/v2/ResourceTypes/User', resourceType: 'ResourceType' },
      }],
    };
  }

  @Get('Schemas')
  schemas() {
    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 1,
      startIndex: 1,
      itemsPerPage: 1,
      Resources: [{
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
        id: coreUserSchema,
        name: 'User',
        description: 'Tenant user roster provisioned through SCIM. Authorization is managed by the identity provider.',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true, caseExact: false, mutability: 'readWrite', returned: 'always', uniqueness: 'server' },
          { name: 'externalId', type: 'string', multiValued: false, required: true, caseExact: true, mutability: 'readWrite', returned: 'always', uniqueness: 'server' },
          { name: 'displayName', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'always', uniqueness: 'none' },
          { name: 'active', type: 'boolean', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'always', uniqueness: 'none' },
          { name: 'emails', type: 'complex', multiValued: true, required: false, mutability: 'readWrite', returned: 'default', subAttributes: [{ name: 'value', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' }, { name: 'type', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' }, { name: 'primary', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' }] },
        ],
      }],
    };
  }

  @Get('Users')
  listUsers(@Headers('authorization') authorization: string, @Query('filter') filter: string | undefined, @Query('startIndex') startIndexRaw?: string, @Query('count') countRaw?: string) {
    const identity = this.scim.identityFor(authorization);
    const startIndex = this.pageNumber(startIndexRaw, 1, 1, 100000);
    const count = this.pageNumber(countRaw, 100, 1, 100);
    return this.scim.listUsers(identity, filter, startIndex, count);
  }

  @Post('Users')
  @HttpCode(201)
  async createUser(@Headers('authorization') authorization: string, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const resource = await this.scim.createUser(this.scim.identityFor(authorization), body);
    response.setHeader('Location', `/api/scim/v2/Users/${resource.id}`);
    return resource;
  }

  @Get('Users/:id')
  getUser(@Headers('authorization') authorization: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.scim.getUser(this.scim.identityFor(authorization), id);
  }

  @Put('Users/:id')
  replaceUser(@Headers('authorization') authorization: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.scim.replaceUser(this.scim.identityFor(authorization), id, body);
  }

  @Patch('Users/:id')
  patchUser(@Headers('authorization') authorization: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.scim.patchUser(this.scim.identityFor(authorization), id, body);
  }

  @Delete('Users/:id')
  @HttpCode(204)
  async deactivateUser(@Headers('authorization') authorization: string, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.scim.deactivateUser(this.scim.identityFor(authorization), id);
  }

  private pageNumber(raw: string | undefined, fallback: number, min: number, max: number) {
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw)) throw new BadRequestException('SCIM pagination parameters must be positive integers.');
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new BadRequestException(`SCIM pagination value must be between ${min} and ${max}.`);
    return value;
  }
}
